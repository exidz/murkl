# Vercel Best Practices for Murkl

## Stack
- Vite 7 + React 19 + TypeScript
- HeroUI components + Framer Motion
- Solana wallet adapters

## Deployment

### vercel.json (SPA deep linking)
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }],
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
  ]
}
```

### Environment Variables
- Prefix with `VITE_` for client access: `VITE_SOLANA_RPC`, `VITE_PROGRAM_ID`
- Use `import.meta.env.VITE_*` in code

## Performance Checklist

### Build
- [ ] `vite build` produces optimized chunks
- [ ] Enable gzip/brotli (Vercel does this automatically)
- [ ] Code split routes with `React.lazy()`

### Assets
- [ ] Images optimized (webp/avif)
- [ ] Fonts preloaded
- [ ] Icons as SVG components or sprite

### Runtime
- [ ] Lazy load wallet adapters
- [ ] Debounce RPC calls
- [ ] Show loading states for async operations
- [ ] Handle errors gracefully with toast/fallback UI

## UX Patterns

### Loading States
```tsx
{isLoading ? <Spinner /> : <Content />}
```

### Error Handling
```tsx
try {
  await transaction();
  toast.success('Done!');
} catch (e) {
  toast.error(e.message || 'Failed');
}
```

### Responsive
- Mobile-first with HeroUI breakpoints
- Test at 375px, 768px, 1024px widths
- Touch targets ≥44px

### Accessibility
- Semantic HTML
- ARIA labels on icon buttons
- Keyboard navigation support
- Color contrast ≥4.5:1

## Preview Deployments
- Every PR gets a preview URL automatically
- Use for testing before merge
- Share preview links for feedback

## Commands
```bash
npm run dev      # Local dev
npm run build    # Production build
npm run preview  # Preview production build locally
vercel           # Deploy to preview
vercel --prod    # Deploy to production
```
