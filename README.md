# 🏮 Tōrō - The River of Souls

A multiplayer .io survival game inspired by the Obon Festival.

## Tech Stack

- **Client:** Phaser 3 + TypeScript + Vite
- **Server:** Node.js + Socket.io + Express
- **Communication:** WebSocket (Socket.io)

## Getting Started

### Install Dependencies

```bash
npm install
```

### Development Mode

Run both client and server in development mode:

```bash
npm run dev
```

Or run them separately:

```bash
# Terminal 1 - Server (port 3001)
npm run dev:server

# Terminal 2 - Client (port 3000)
npm run dev:client
```

### Controls

- **Mouse Position:** Controls direction and speed (further = faster)
- **Space / Left Click:** Boost (increases speed by 50%)

## Project Structure

```
toro/
├── client/           # Phaser 3 game client
│   ├── src/
│   │   ├── main.ts         # Entry point
│   │   ├── config.ts       # Game configuration
│   │   └── scenes/
│   │       └── GameScene.ts # Main game scene
│   ├── index.html
│   └── vite.config.ts
├── server/           # Socket.io game server
│   └── src/
│       └── index.ts        # Server entry point
├── shared/           # Shared types between client/server
│   └── types.ts
└── package.json
```

## Development Phases

- [x] **Phase 1:** Basic setup with Phaser + Socket.io + Vite
- [ ] **Phase 2:** Multiplayer movement with snapshot interpolation
- [ ] **Phase 3:** Snake logic (body segments following head)
- [ ] **Phase 4:** Combat & collision detection
- [ ] **Phase 5:** Juice & polish (fog of war, bloom effects, classes)

