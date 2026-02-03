//! Murkl CLI types

use serde::{Deserialize, Serialize};

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
    pub fn get_proof(&self, index: u32) -> Vec<[u8; 32]> {
        // For now, return empty proof (simplified tree)
        // In production, compute actual sibling path
        vec![]
    }
}

/// STARK proof
#[derive(Debug, Clone)]
pub struct MurklProof {
    pub trace_commitment: [u8; 32],
    pub composition_commitment: [u8; 32],
    pub oods_values: Vec<QM31>,
    pub fri_layers: Vec<FriLayerProof>,
    pub last_layer_poly: Vec<QM31>,
    pub query_positions: Vec<u32>,
    pub trace_decommitments: Vec<Vec<[u8; 32]>>,
}

impl MurklProof {
    pub fn serialize(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        
        // Trace commitment
        bytes.extend_from_slice(&self.trace_commitment);
        
        // Composition commitment
        bytes.extend_from_slice(&self.composition_commitment);
        
        // OODS values count + values
        bytes.extend_from_slice(&(self.oods_values.len() as u32).to_le_bytes());
        for val in &self.oods_values {
            bytes.extend_from_slice(&val.a.to_le_bytes());
            bytes.extend_from_slice(&val.b.to_le_bytes());
            bytes.extend_from_slice(&val.c.to_le_bytes());
            bytes.extend_from_slice(&val.d.to_le_bytes());
        }
        
        // FRI layers count
        bytes.extend_from_slice(&(self.fri_layers.len() as u32).to_le_bytes());
        for layer in &self.fri_layers {
            bytes.extend_from_slice(&layer.commitment);
            bytes.extend_from_slice(&(layer.evaluations.len() as u32).to_le_bytes());
            for eval in &layer.evaluations {
                bytes.extend_from_slice(&eval.a.to_le_bytes());
                bytes.extend_from_slice(&eval.b.to_le_bytes());
                bytes.extend_from_slice(&eval.c.to_le_bytes());
                bytes.extend_from_slice(&eval.d.to_le_bytes());
            }
            // Merkle paths
            bytes.extend_from_slice(&(layer.merkle_paths.len() as u32).to_le_bytes());
            for path in &layer.merkle_paths {
                bytes.extend_from_slice(&(path.len() as u32).to_le_bytes());
                for node in path {
                    bytes.extend_from_slice(node);
                }
            }
        }
        
        // Last layer poly
        bytes.extend_from_slice(&(self.last_layer_poly.len() as u32).to_le_bytes());
        for coeff in &self.last_layer_poly {
            bytes.extend_from_slice(&coeff.a.to_le_bytes());
            bytes.extend_from_slice(&coeff.b.to_le_bytes());
            bytes.extend_from_slice(&coeff.c.to_le_bytes());
            bytes.extend_from_slice(&coeff.d.to_le_bytes());
        }
        
        // Query positions
        bytes.extend_from_slice(&(self.query_positions.len() as u32).to_le_bytes());
        for pos in &self.query_positions {
            bytes.extend_from_slice(&pos.to_le_bytes());
        }
        
        // Trace decommitments
        bytes.extend_from_slice(&(self.trace_decommitments.len() as u32).to_le_bytes());
        for path in &self.trace_decommitments {
            bytes.extend_from_slice(&(path.len() as u32).to_le_bytes());
            for node in path {
                bytes.extend_from_slice(node);
            }
        }
        
        bytes
    }
    
    pub fn deserialize(bytes: &[u8]) -> Self {
        let mut offset = 0;
        
        let mut trace_commitment = [0u8; 32];
        trace_commitment.copy_from_slice(&bytes[offset..offset+32]);
        offset += 32;
        
        let mut composition_commitment = [0u8; 32];
        composition_commitment.copy_from_slice(&bytes[offset..offset+32]);
        offset += 32;
        
        // OODS values
        let oods_count = u32::from_le_bytes(bytes[offset..offset+4].try_into().unwrap()) as usize;
        offset += 4;
        let mut oods_values = Vec::with_capacity(oods_count);
        for _ in 0..oods_count {
            let a = u32::from_le_bytes(bytes[offset..offset+4].try_into().unwrap());
            offset += 4;
            let b = u32::from_le_bytes(bytes[offset..offset+4].try_into().unwrap());
            offset += 4;
            let c = u32::from_le_bytes(bytes[offset..offset+4].try_into().unwrap());
            offset += 4;
            let d = u32::from_le_bytes(bytes[offset..offset+4].try_into().unwrap());
            offset += 4;
            oods_values.push(QM31 { a, b, c, d });
        }
        
        // For simplicity, return minimal proof structure
        // Full deserialization would continue similarly
        
        Self {
            trace_commitment,
            composition_commitment,
            oods_values,
            fri_layers: vec![],
            last_layer_poly: vec![],
            query_positions: vec![],
            trace_decommitments: vec![],
        }
    }
}

/// QM31 extension field element
#[derive(Debug, Clone, Copy, Default)]
pub struct QM31 {
    pub a: u32,
    pub b: u32,
    pub c: u32,
    pub d: u32,
}

/// FRI layer proof
#[derive(Debug, Clone)]
pub struct FriLayerProof {
    pub commitment: [u8; 32],
    pub evaluations: Vec<QM31>,
    pub merkle_paths: Vec<Vec<[u8; 32]>>,
}
