# Implementation Guides Index

> AI-ready prompts for Phase 7 optimization implementation

---

## Quick Start

Each guide contains:
1. **Problem** - What we're solving
2. **Solution** - High-level approach
3. **Implementation Guide** - Step-by-step with code
4. **Testing Checklist** - How to verify it works
5. **AI Prompt** - Copy-paste ready prompt

---

## Implementation Order

### Week 1: Foundation (🔴 CRITICAL)

| # | Guide | Impact | Est. Time |
|---|-------|--------|-----------|
| 1 | [Object Pooling](./IMPL-001-object-pooling.md) | Eliminates GC stuttering | 2 days |
| 2 | [Texture Atlas](./IMPL-002-texture-atlas.md) | 2-5x mobile FPS | 1 day |
| 3 | [Viewport Filtering](./IMPL-003-viewport-filtering.md) | 4x player capacity | 2 days |

### Week 2: Input & Feel (🟡 HIGH)

| # | Guide | Impact | Est. Time |
|---|-------|--------|-----------|
| 4 | [Rotation Prediction](./IMPL-004-rotation-prediction.md) | Instant input feel | 2 days |
| 5 | [Visual Juice](./IMPL-005-visual-juice.md) | Satisfying actions | 2 days |
| 6 | [Smooth Camera](./IMPL-006-smooth-camera.md) | Professional feel | 1 day |
| 7 | [Adaptive Quality](./IMPL-007-adaptive-quality.md) | 60fps all devices | 1 day |

### Week 3-4: Scale & Polish (🟢 MEDIUM)

| # | Guide | Impact | Est. Time |
|---|-------|--------|-----------|
| 8 | Delta Compression | 60% bandwidth reduction | 2 days |
| 9 | Binary Protocol | 50% more bandwidth | 3 days |
| 10 | [Audio System](./IMPL-010-audio-system.md) | Engagement layer | 2 days |

---

## Guides Available

### ✅ Complete
- `IMPL-001-object-pooling.md` - Sprite and object pooling
- `IMPL-002-texture-atlas.md` - Combined texture atlas
- `IMPL-003-viewport-filtering.md` - Server-side culling
- `IMPL-004-rotation-prediction.md` - Client rotation prediction
- `IMPL-005-visual-juice.md` - Particles and effects
- `IMPL-006-smooth-camera.md` - Camera with lookahead
- `IMPL-007-adaptive-quality.md` - Auto quality scaling
- `IMPL-010-audio-system.md` - Sound effects and music
- `IMPL-011-bot-system.md` - AI bots with steering behaviors

### 📝 To Be Created
- `IMPL-008-delta-compression.md`
- `IMPL-009-binary-protocol.md`
- `IMPL-012-kill-feed.md`
- `IMPL-013-reconnection.md`
- `IMPL-014-anti-cheat.md`

---

## How to Use

### For AI Implementation

1. Read the main synthesis doc: `RFC-008-optimization-synthesis.md`
2. Pick an implementation from the priority order above
3. Open the specific IMPL guide
4. Copy the "AI Implementation Prompt" section
5. Feed to your AI assistant with context about your current code

### Example Prompt

```
I'm working on the Tōrō game (snake.io clone).

[Paste current relevant code if needed]

Please implement [FEATURE] following the guide in docs/impl/IMPL-XXX.md.

Focus on:
- Matching the existing code style
- Integrating with GameScene.ts
- Maintaining existing functionality
```

---

## Dependencies

Some implementations depend on others:

```
Texture Atlas → Object Pooling (pools use atlas)
Viewport Filtering → none
Rotation Prediction → none
Visual Juice → Object Pooling (particles pooled)
Smooth Camera → none
Adaptive Quality → Object Pooling (controls limits)
Delta Compression → Viewport Filtering
Binary Protocol → Delta Compression (optional)
Audio System → none
Bot System → none (server-side only)
```

**Recommended order:** Follow the Week 1 → Week 2 → Week 3-4 order above.

---

## Success Metrics

After implementing all guides:

| Metric | Before | After |
|--------|--------|-------|
| Mobile FPS | 30-45 | 60 stable |
| Desktop FPS | 60-90 | 144+ |
| Input Latency | ~100ms | <20ms |
| Bandwidth/Player | 50 KB/s | <10 KB/s |
| Players/Room | 10-15 | 50+ |
| GC Pauses | Frequent | None |

---

## Questions?

Each guide includes a testing checklist. If something doesn't work:

1. Check the console for errors
2. Verify dependencies are implemented
3. Check the testing checklist items
4. Compare with the code samples in the guide

---

*These guides were synthesized from 5 AI optimization proposals.*
*See `RFC-008-optimization-synthesis.md` for the full analysis.*


