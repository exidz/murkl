//! Murkl CLI types
//!
//! Re-exports shared types from murkl-prover SDK.

use serde::{Deserialize, Serialize};

// Re-export QM31 from SDK
pub use murkl_prover::QM31;

/// Merkle tree data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MerkleData {
    pub root: Vec<u8>,
    pub leaves: Vec<Vec<u8>>,
    pub depth: u32,
}

impl MerkleData {
    /// Find the index of a leaf
    pub fn find_leaf(&self, commitment: &[u8]) -> Option<u32> {
        self.leaves.iter()
            .position(|leaf| leaf == commitment)
            .map(|i| i as u32)
    }
    
    /// Get Merkle proof for a leaf
    pub fn get_proof(&self, _index: u32) -> Vec<[u8; 32]> {
        // For now, return empty proof (simplified tree)
        // In production, compute actual sibling path
        vec![]
    }
}

/// FRI layer proof
#[derive(Debug, Clone)]
pub struct FriLayerProof {
    pub commitment: [u8; 32],
    pub evaluations: Vec<QM31>,
    pub merkle_paths: Vec<Vec<[u8; 32]>>,
}

/// Query proof for a single query
#[derive(Debug, Clone)]
pub struct QueryProof {
    pub index: u32,
    pub trace_value: [u8; 32],
    pub trace_path: Vec<[u8; 32]>,
    pub composition_value: [u8; 32],
    pub composition_path: Vec<[u8; 32]>,
    /// Per FRI layer: 4 sibling QM31 values + Merkle path
    pub fri_layer_data: Vec<(Vec<QM31>, Vec<[u8; 32]>)>,
}

/// STARK proof - format matches on-chain verifier
#[derive(Debug, Clone)]
pub struct MurklProof {
    pub trace_commitment: [u8; 32],
    pub composition_commitment: [u8; 32],
    pub trace_oods: QM31,
    pub composition_oods: QM31,
    pub fri_layer_commitments: Vec<[u8; 32]>,
    pub fri_final_poly: Vec<QM31>,
    pub queries: Vec<QueryProof>,
    
    // Legacy fields for compatibility (ignored in new format)
    pub oods_values: Vec<QM31>,
    pub fri_layers: Vec<FriLayerProof>,
    pub last_layer_poly: Vec<QM31>,
    pub query_positions: Vec<u32>,
    pub trace_decommitments: Vec<Vec<[u8; 32]>>,
}

impl MurklProof {
    /// Serialize to format expected by on-chain verifier
    pub fn serialize(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        
        // 1. Trace commitment (32 bytes)
        bytes.extend_from_slice(&self.trace_commitment);
        
        // 2. Composition commitment (32 bytes)
        bytes.extend_from_slice(&self.composition_commitment);
        
        // 3. Trace OODS (16 bytes QM31)
        bytes.extend_from_slice(&self.trace_oods.to_bytes());
        
        // 4. Composition OODS (16 bytes QM31)
        bytes.extend_from_slice(&self.composition_oods.to_bytes());
        
        // 5. FRI layer count (1 byte)
        bytes.push(self.fri_layer_commitments.len() as u8);
        
        // 6. FRI layer commitments (32 bytes each)
        for commitment in &self.fri_layer_commitments {
            bytes.extend_from_slice(commitment);
        }
        
        // 7. Final polynomial count (2 bytes u16)
        bytes.extend_from_slice(&(self.fri_final_poly.len() as u16).to_le_bytes());
        
        // 8. Final polynomial coefficients (16 bytes QM31 each)
        for coeff in &self.fri_final_poly {
            bytes.extend_from_slice(&coeff.to_bytes());
        }
        
        // 9. Query count (1 byte)
        bytes.push(self.queries.len() as u8);
        
        // 10. Queries
        for query in &self.queries {
            // Index (4 bytes)
            bytes.extend_from_slice(&query.index.to_le_bytes());
            
            // Trace value (32 bytes)
            bytes.extend_from_slice(&query.trace_value);
            
            // Trace path length (1 byte)
            bytes.push(query.trace_path.len() as u8);
            
            // Trace path (32 bytes each)
            for node in &query.trace_path {
                bytes.extend_from_slice(node);
            }
            
            // Composition value (32 bytes)
            bytes.extend_from_slice(&query.composition_value);
            
            // Composition path length (1 byte)
            bytes.push(query.composition_path.len() as u8);
            
            // Composition path (32 bytes each)
            for node in &query.composition_path {
                bytes.extend_from_slice(node);
            }
            
            // FRI layer data (per layer: 4 siblings + path)
            for (siblings, path) in &query.fri_layer_data {
                // 4 sibling values (16 bytes QM31 each = 64 bytes)
                for i in 0..4 {
                    let sibling = siblings.get(i).copied().unwrap_or_default();
                    bytes.extend_from_slice(&sibling.to_bytes());
                }
                
                // Path length (1 byte)
                bytes.push(path.len() as u8);
                
                // Path (32 bytes each)
                for node in path {
                    bytes.extend_from_slice(node);
                }
            }
        }
        
        bytes
    }
    
    /// Create a new proof from builder parts
    pub fn from_parts(
        trace_commitment: [u8; 32],
        composition_commitment: [u8; 32],
        trace_oods: QM31,
        composition_oods: QM31,
        fri_layer_commitments: Vec<[u8; 32]>,
        fri_final_poly: Vec<QM31>,
        queries: Vec<QueryProof>,
    ) -> Self {
        Self {
            trace_commitment,
            composition_commitment,
            trace_oods,
            composition_oods,
            fri_layer_commitments,
            fri_final_poly,
            queries,
            // Legacy (unused)
            oods_values: vec![],
            fri_layers: vec![],
            last_layer_poly: vec![],
            query_positions: vec![],
            trace_decommitments: vec![],
        }
    }
    
    /// Deserialize (for local verification)
    pub fn deserialize(bytes: &[u8]) -> Self {
        let mut offset = 0;
        
        let mut trace_commitment = [0u8; 32];
        trace_commitment.copy_from_slice(&bytes[offset..offset+32]);
        offset += 32;
        
        let mut composition_commitment = [0u8; 32];
        composition_commitment.copy_from_slice(&bytes[offset..offset+32]);
        offset += 32;
        
        let trace_oods = Self::parse_qm31(&bytes[offset..offset+16]);
        offset += 16;
        
        let composition_oods = Self::parse_qm31(&bytes[offset..offset+16]);
        offset += 16;
        
        let num_fri_layers = bytes[offset] as usize;
        offset += 1;
        
        let mut fri_layer_commitments = Vec::with_capacity(num_fri_layers);
        for _ in 0..num_fri_layers {
            let mut commitment = [0u8; 32];
            commitment.copy_from_slice(&bytes[offset..offset+32]);
            fri_layer_commitments.push(commitment);
            offset += 32;
        }
        
        let final_poly_count = u16::from_le_bytes([bytes[offset], bytes[offset+1]]) as usize;
        offset += 2;
        
        let mut fri_final_poly = Vec::with_capacity(final_poly_count);
        for _ in 0..final_poly_count {
            fri_final_poly.push(Self::parse_qm31(&bytes[offset..offset+16]));
            offset += 16;
        }
        
        let num_queries = bytes[offset] as usize;
        offset += 1;
        
        let mut queries = Vec::with_capacity(num_queries);
        for _ in 0..num_queries {
            let index = u32::from_le_bytes(bytes[offset..offset+4].try_into().unwrap());
            offset += 4;
            
            let mut trace_value = [0u8; 32];
            trace_value.copy_from_slice(&bytes[offset..offset+32]);
            offset += 32;
            
            let trace_path_len = bytes[offset] as usize;
            offset += 1;
            
            let mut trace_path = Vec::with_capacity(trace_path_len);
            for _ in 0..trace_path_len {
                let mut node = [0u8; 32];
                node.copy_from_slice(&bytes[offset..offset+32]);
                trace_path.push(node);
                offset += 32;
            }
            
            let mut composition_value = [0u8; 32];
            composition_value.copy_from_slice(&bytes[offset..offset+32]);
            offset += 32;
            
            let comp_path_len = bytes[offset] as usize;
            offset += 1;
            
            let mut composition_path = Vec::with_capacity(comp_path_len);
            for _ in 0..comp_path_len {
                let mut node = [0u8; 32];
                node.copy_from_slice(&bytes[offset..offset+32]);
                composition_path.push(node);
                offset += 32;
            }
            
            let mut fri_layer_data = Vec::with_capacity(num_fri_layers);
            for _ in 0..num_fri_layers {
                let mut siblings = Vec::with_capacity(4);
                for _ in 0..4 {
                    siblings.push(Self::parse_qm31(&bytes[offset..offset+16]));
                    offset += 16;
                }
                
                let path_len = bytes[offset] as usize;
                offset += 1;
                
                let mut path = Vec::with_capacity(path_len);
                for _ in 0..path_len {
                    let mut node = [0u8; 32];
                    node.copy_from_slice(&bytes[offset..offset+32]);
                    path.push(node);
                    offset += 32;
                }
                
                fri_layer_data.push((siblings, path));
            }
            
            queries.push(QueryProof {
                index,
                trace_value,
                trace_path,
                composition_value,
                composition_path,
                fri_layer_data,
            });
        }
        
        Self {
            trace_commitment,
            composition_commitment,
            trace_oods,
            composition_oods,
            fri_layer_commitments,
            fri_final_poly,
            queries,
            oods_values: vec![],
            fri_layers: vec![],
            last_layer_poly: vec![],
            query_positions: vec![],
            trace_decommitments: vec![],
        }
    }
    
    fn parse_qm31(bytes: &[u8]) -> QM31 {
        // Use SDK's from_bytes method
        QM31::from_bytes(bytes)
    }
}
