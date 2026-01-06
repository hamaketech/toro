# RFC-008: Professional Optimization Synthesis

> Consolidated optimization roadmap from 5 AI analysis proposals

**Date:** January 2026  
**Status:** Ready for Implementation  
**Based on:** Composer, GPT-5.2, Gemini-3-Flash, Claude Opus 4, Claude Sonnet 4.5 proposals

---

## Executive Summary

This document synthesizes optimization recommendations from 5 AI models into a unified implementation roadmap. The goal is to achieve **slither.io-level performance** with:

| Metric | Current | Target |
|--------|---------|--------|
| Mobile FPS | 30-45 | 60 stable |
| Input Latency | ~100ms | <20ms perceived |
| Players/Room | 10-15 | 50+ |
| Bandwidth/Player | ~50 KB/s | <10 KB/s |
| GC Pauses | Frequent | None |

---

## Optimization Categories

### 🔴 CRITICAL (Do First)
1. **Object Pooling** - Eliminates GC stuttering
2. **Texture Atlas** - 2-5x mobile FPS improvement
3. **Viewport Filtering** - 4x player capacity

### 🟡 HIGH PRIORITY (Core Polish)
4. **Client Prediction (Rotation Only)** - Instant input feel
5. **Visual Juice System** - Makes actions satisfying
6. **Smooth Camera** - Professional feel
7. **Adaptive Quality** - Consistent FPS on all devices

### 🟢 MEDIUM PRIORITY (Scale & Polish)
8. **Delta Compression** - 60-80% bandwidth reduction
9. **Binary Protocol** - Further 50% bandwidth reduction
10. **Audio System** - Engagement layer
11. **Kill Feed & Notifications** - Social engagement

### 🔵 LOW PRIORITY (Nice-to-Have)
12. **Reconnection System** - Player retention
13. **Anti-Cheat Validation** - Competitive integrity
14. **Performance Monitoring** - Debugging & analytics
15. **Spectator Mode** - Retention after death

---

## Consensus Analysis

### All 5 Models Agreed On:
- ✅ Object pooling is essential (GC is the #1 cause of stuttering)
- ✅ Texture atlas dramatically improves mobile performance
- ✅ Delta/diff compression reduces bandwidth significantly
- ✅ Adaptive quality system enables low-end device support
- ✅ Camera smoothing transforms "game feel"
- ✅ Visual feedback (particles, popups) makes actions satisfying

### 4/5 Models Agreed On:
- ✅ Client prediction should be LIMITED (rotation only, not position)
- ✅ Viewport filtering is critical for scaling beyond 20 players
- ✅ Dynamic zoom based on player size improves UX
- ✅ Audio system significantly improves engagement

### Unique Valuable Ideas:
- **Gemini:** Catmull-Rom splines for smoother body rendering
- **GPT-5.2:** Split simulation tick from network send tick
- **Composer:** Priority-based interest management (CRITICAL > HIGH > LOW entities)
- **Opus:** Respawn invincibility prevents frustrating spawn kills
- **Sonnet:** Reconnection system with 30s grace period

---

## Implementation Phases

### Phase 7A: Foundation (Week 1)
Focus: Eliminate performance blockers

| Task | Impact | Effort | Files |
|------|--------|--------|-------|
| Object Pooling | 🔴 Critical | 2 days | GameScene.ts, new Pool classes |
| Texture Atlas | 🔴 Critical | 1 day | assets, vite config |
| Server Instrumentation | 🟡 High | 0.5 day | server/index.ts |

### Phase 7B: Network & Feel (Week 2)
Focus: Responsive controls + bandwidth reduction

| Task | Impact | Effort | Files |
|------|--------|--------|-------|
| Rotation Prediction | 🟡 High | 2 days | ClientPrediction.ts |
| Viewport Filtering | 🔴 Critical | 2 days | server/index.ts |
| Smooth Camera | 🟡 High | 1 day | GameScene.ts |

### Phase 7C: Visual Polish (Week 3)
Focus: "Juice" that makes actions satisfying

| Task | Impact | Effort | Files |
|------|--------|--------|-------|
| Score Popups | 🟡 High | 0.5 day | new ScorePopup.ts |
| Death Particles | 🟡 High | 1 day | new DeathEffect.ts |
| Collection Effects | 🟡 High | 1 day | GameScene.ts |
| Adaptive Quality | 🟡 High | 1 day | new QualityManager.ts |

### Phase 7D: Bandwidth & Scale (Week 4)
Focus: Support 50+ players

| Task | Impact | Effort | Files |
|------|--------|--------|-------|
| Delta Compression | 🟢 Medium | 2 days | server/index.ts, client |
| Binary Protocol | 🟢 Medium | 3 days | shared/protocol.ts |
| Adaptive Tick Rate | 🟢 Medium | 1 day | server/index.ts |

### Phase 7E: Polish & UX (Week 5)
Focus: Professional features

| Task | Impact | Effort | Files |
|------|--------|--------|-------|
| Audio System | 🟢 Medium | 2 days | new AudioManager.ts |
| Kill Feed | 🟢 Medium | 1 day | new KillFeed.ts |
| Connection Indicator | 🔵 Low | 0.5 day | GameScene.ts |
| Dynamic Zoom | 🟢 Medium | 0.5 day | GameScene.ts |

---

## Detailed Implementation Guidelines

Each optimization below has a dedicated implementation guide in `docs/impl/`.

### 1. Object Pooling
**Files:** `docs/impl/IMPL-001-object-pooling.md`

### 2. Texture Atlas
**Files:** `docs/impl/IMPL-002-texture-atlas.md`

### 3. Viewport Filtering
**Files:** `docs/impl/IMPL-003-viewport-filtering.md`

### 4. Client Prediction (Rotation Only)
**Files:** `docs/impl/IMPL-004-rotation-prediction.md`

### 5. Visual Juice System
**Files:** `docs/impl/IMPL-005-visual-juice.md`

### 6. Smooth Camera
**Files:** `docs/impl/IMPL-006-smooth-camera.md`

### 7. Adaptive Quality
**Files:** `docs/impl/IMPL-007-adaptive-quality.md`

### 8. Delta Compression
**Files:** `docs/impl/IMPL-008-delta-compression.md`

### 9. Binary Protocol
**Files:** `docs/impl/IMPL-009-binary-protocol.md`

### 10. Audio System
**Files:** `docs/impl/IMPL-010-audio-system.md`

---

## Success Metrics

### Performance Benchmarks
```
✅ Mobile FPS: Sustained 60fps on iPhone 12 / Galaxy S21
✅ Desktop FPS: Sustained 144fps on mid-range GPU
✅ Input latency: <16ms from mouse move to visual rotation
✅ Server tick: p95 < 30ms at 50 players
✅ Bandwidth: <10 KB/s per client at 50 players
```

### Player Experience
```
✅ No visible GC stuttering during gameplay
✅ Smooth camera that feels "floaty" not "robotic"
✅ Satisfying visual/audio feedback on collection and kills
✅ Works on 4G mobile networks
✅ "Feels like a real game" (user feedback)
```

---

## Risk Mitigation

### Client Prediction Risks
**Problem:** Full position prediction causes mobile jitter/desync.
**Solution:** Only predict ROTATION, not position. Position stays server-authoritative.

### Texture Atlas Risks
**Problem:** Large atlas causes memory issues on low-end devices.
**Solution:** Keep atlas under 2048x2048, use multiple smaller atlases if needed.

### Binary Protocol Risks
**Problem:** Debugging is harder with binary.
**Solution:** Keep JSON fallback for development, add protocol version header.

---

## Architecture Decisions

### Why Rotation-Only Prediction (Consensus)
All models agreed that full client prediction introduces complexity and mobile jitter. The compromise:
- **Predict:** Rotation/angle (instant visual feedback)
- **Interpolate:** Position (server authoritative, smooth)

This gives ~90% of the responsiveness benefit with ~10% of the complexity.

### Why Not WebRTC (Rejected)
Opus proposed WebRTC DataChannels for UDP-like delivery. However:
- Significant implementation complexity
- Requires STUN/TURN servers
- WebSocket latency is acceptable for this game type
- Not worth the complexity unless proven bottleneck

### Why Server-Authoritative Stays (Confirmed)
All models confirmed keeping server as the source of truth:
- Prevents cheating
- Simplifies collision logic
- Works well with viewport filtering

---

## File Structure After Implementation

```
toro/
├── client/
│   ├── src/
│   │   ├── audio/
│   │   │   └── AudioManager.ts       # Sound effects system
│   │   ├── effects/
│   │   │   ├── DeathEffect.ts        # Death explosion particles
│   │   │   ├── CollectionEffect.ts   # Food collection particles
│   │   │   └── ScorePopup.ts         # Floating +1 numbers
│   │   ├── network/
│   │   │   ├── ClientPrediction.ts   # Rotation prediction
│   │   │   ├── SnapshotInterpolation.ts
│   │   │   └── BinaryDecoder.ts      # Binary protocol decoder
│   │   ├── pools/
│   │   │   ├── SpritePool.ts         # Generic sprite pooling
│   │   │   ├── FoodPool.ts           # Food-specific pool
│   │   │   └── SegmentPool.ts        # Body segment pool
│   │   ├── systems/
│   │   │   ├── QualityManager.ts     # Adaptive quality
│   │   │   ├── SmoothCamera.ts       # Camera with lookahead
│   │   │   └── PerformanceMonitor.ts # FPS/debug display
│   │   ├── ui/
│   │   │   ├── KillFeed.ts           # Kill notifications
│   │   │   └── ConnectionIndicator.ts
│   │   ├── scenes/
│   │   │   ├── GameScene.ts          # Main game (modified)
│   │   │   └── MainMenuScene.ts
│   │   └── config.ts
│   └── public/
│       ├── atlas/
│       │   ├── toro.png              # Texture atlas
│       │   └── toro.json             # Atlas metadata
│       └── audio/
│           ├── collect.mp3
│           ├── collect-gold.mp3
│           ├── death.mp3
│           └── ambient.mp3
├── server/
│   └── src/
│       ├── index.ts                  # Main server (modified)
│       ├── network/
│       │   ├── ViewportFilter.ts     # Per-client filtering
│       │   ├── DeltaCompressor.ts    # State diffing
│       │   └── BinaryEncoder.ts      # Binary protocol
│       ├── validation/
│       │   └── AntiCheat.ts          # Input validation
│       └── analytics/
│           └── Metrics.ts            # Performance tracking
└── shared/
    ├── types.ts
    └── protocol.ts                   # Binary protocol definitions
```

---

## Next Steps

1. **Review this document** - Confirm priorities match your vision
2. **Start Phase 7A** - Object Pooling + Texture Atlas (biggest wins)
3. **Measure baseline** - Record current FPS/bandwidth before changes
4. **Iterate** - Each phase should be tested before moving to next

---

## Quick Reference: AI Prompts

When you're ready to implement each feature, use the detailed guides in `docs/impl/`.

Example prompt structure:
```
"Implement [FEATURE] following docs/impl/IMPL-XXX.md. 
The current codebase has [CONTEXT]. 
Focus on [SPECIFIC ASPECT]."
```

---

*Synthesis document compiled from 5 AI optimization proposals*
*Ready to begin implementation*


