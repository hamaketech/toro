import type { GameSnapshot, PlayerState, Hitodama, BodySegment, ScoreboardEntry } from '@shared/types';
import { GAME_CONFIG } from '../config';

/**
 * Interpolated player state at a specific render time
 */
export interface InterpolatedPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  score: number;
  targetLength: number;
  bodySegments: BodySegment[];
  alive: boolean;
  kills: number;
}

/**
 * Interpolated food state
 */
export interface InterpolatedFood {
  id: string;
  x: number;
  y: number;
  value: number;
  radius: number;
}

/**
 * SnapshotInterpolation manages a buffer of server snapshots
 * and provides smooth interpolation between them for rendering
 * other players and food without jitter.
 */
export class SnapshotInterpolation {
  private snapshots: GameSnapshot[] = [];
  private serverTimeOffset = 0;
  private rtt = 0;

  /**
   * Add a new snapshot to the buffer
   */
  addSnapshot(snapshot: GameSnapshot): void {
    // Insert in order by tick
    const insertIndex = this.snapshots.findIndex(s => s.tick > snapshot.tick);
    if (insertIndex === -1) {
      this.snapshots.push(snapshot);
    } else {
      this.snapshots.splice(insertIndex, 0, snapshot);
    }

    // Trim buffer if too large
    while (this.snapshots.length > GAME_CONFIG.NETWORK.SNAPSHOT_BUFFER_SIZE) {
      this.snapshots.shift();
    }
  }

  /**
   * Update time synchronization
   */
  updateTimeSync(serverTime: number, clientSendTime: number): void {
    const now = Date.now();
    this.rtt = now - clientSendTime;
    // Server time at the moment we received the pong
    const estimatedServerTime = serverTime + this.rtt / 2;
    this.serverTimeOffset = estimatedServerTime - now;
  }

  /**
   * Get current estimated server time
   */
  getServerTime(): number {
    return Date.now() + this.serverTimeOffset;
  }

  /**
   * Get the render time (server time minus interpolation delay)
   */
  getRenderTime(): number {
    return this.getServerTime() - GAME_CONFIG.NETWORK.INTERPOLATION_DELAY;
  }

  /**
   * Get round-trip time
   */
  getRTT(): number {
    return this.rtt;
  }

  /**
   * Get the latest scoreboard
   */
  getScoreboard(): ScoreboardEntry[] {
    if (this.snapshots.length === 0) return [];
    return this.snapshots[this.snapshots.length - 1].scoreboard || [];
  }

  /**
   * Get interpolated states for all players at current render time
   */
  getInterpolatedPlayers(excludePlayerId?: string): Map<string, InterpolatedPlayer> {
    const result = new Map<string, InterpolatedPlayer>();
    const renderTime = this.getRenderTime();

    // Find the two snapshots to interpolate between
    const { before, after, t } = this.findInterpolationSnapshots(renderTime);

    if (!before) {
      return result;
    }

    if (!after) {
      const snapshot = this.snapshots[this.snapshots.length - 1];
      for (const [id, player] of Object.entries(snapshot.players)) {
        if (id === excludePlayerId) continue;
        result.set(id, this.playerStateToInterpolated(player));
      }
      return result;
    }

    // Interpolate between the two snapshots
    for (const [id, playerAfter] of Object.entries(after.players)) {
      if (id === excludePlayerId) continue;

      const playerBefore = before.players[id];
      if (!playerBefore) {
        result.set(id, this.playerStateToInterpolated(playerAfter));
        continue;
      }

      result.set(id, this.interpolatePlayer(playerBefore, playerAfter, t));
    }

    return result;
  }

  /**
   * Get interpolated food items
   * Food moves slowly (magnetic pull), so we interpolate for smoothness
   */
  getInterpolatedFood(): Map<string, InterpolatedFood> {
    const result = new Map<string, InterpolatedFood>();
    const renderTime = this.getRenderTime();

    const { before, after, t } = this.findInterpolationSnapshots(renderTime);

    if (!before) {
      return result;
    }

    // Build maps for quick lookup
    const beforeFoodMap = new Map<string, Hitodama>();
    if (before.food?.items) {
      for (const item of before.food.items) {
        beforeFoodMap.set(item.id, item);
      }
    }

    // Use 'after' snapshot if available, otherwise use latest
    const targetSnapshot = after || this.snapshots[this.snapshots.length - 1];
    if (!targetSnapshot.food?.items) {
      return result;
    }

    for (const item of targetSnapshot.food.items) {
      const beforeItem = beforeFoodMap.get(item.id);
      
      if (beforeItem && after) {
        // Interpolate position
        result.set(item.id, {
          id: item.id,
          x: this.lerp(beforeItem.x, item.x, t),
          y: this.lerp(beforeItem.y, item.y, t),
          value: item.value,
          radius: item.radius,
        });
      } else {
        // New food or no interpolation needed
        result.set(item.id, {
          id: item.id,
          x: item.x,
          y: item.y,
          value: item.value,
          radius: item.radius,
        });
      }
    }

    return result;
  }

  /**
   * Get the latest server state for a specific player (for reconciliation)
   */
  getLatestPlayerState(playerId: string): PlayerState | null {
    if (this.snapshots.length === 0) return null;
    
    const latestSnapshot = this.snapshots[this.snapshots.length - 1];
    return latestSnapshot.players[playerId] || null;
  }

  /**
   * Find the two snapshots to interpolate between
   */
  private findInterpolationSnapshots(renderTime: number): {
    before: GameSnapshot | null;
    after: GameSnapshot | null;
    t: number;
  } {
    if (this.snapshots.length === 0) {
      return { before: null, after: null, t: 0 };
    }

    let before: GameSnapshot | null = null;
    let after: GameSnapshot | null = null;

    for (let i = 0; i < this.snapshots.length; i++) {
      const snapshot = this.snapshots[i];
      if (snapshot.serverTime <= renderTime) {
        before = snapshot;
      } else {
        after = snapshot;
        break;
      }
    }

    if (!before || !after) {
      return { before: before || this.snapshots[0], after: null, t: 0 };
    }

    const timeBetween = after.serverTime - before.serverTime;
    const timeSinceBefore = renderTime - before.serverTime;
    const t = timeBetween > 0 ? Math.min(1, Math.max(0, timeSinceBefore / timeBetween)) : 0;

    return { before, after, t };
  }

  /**
   * Interpolate between two player states
   */
  private interpolatePlayer(
    before: PlayerState,
    after: PlayerState,
    t: number
  ): InterpolatedPlayer {
    return {
      id: after.id,
      name: after.name,
      x: this.lerp(before.x, after.x, t),
      y: this.lerp(before.y, after.y, t),
      angle: this.lerpAngle(before.angle, after.angle, t),
      speed: this.lerp(before.speed, after.speed, t),
      score: after.score,
      targetLength: after.targetLength,
      bodySegments: this.interpolateBodySegments(before.bodySegments, after.bodySegments, t),
      alive: after.alive,
      kills: after.kills,
    };
  }

  /**
   * Interpolate body segments
   */
  private interpolateBodySegments(
    before: BodySegment[],
    after: BodySegment[],
    t: number
  ): BodySegment[] {
    const result: BodySegment[] = [];
    const maxLength = Math.max(before.length, after.length);

    for (let i = 0; i < maxLength; i++) {
      const segBefore = before[i];
      const segAfter = after[i];

      if (segBefore && segAfter) {
        result.push({
          x: this.lerp(segBefore.x, segAfter.x, t),
          y: this.lerp(segBefore.y, segAfter.y, t),
        });
      } else if (segAfter) {
        result.push({ x: segAfter.x, y: segAfter.y });
      }
    }

    return result;
  }

  /**
   * Convert PlayerState to InterpolatedPlayer
   */
  private playerStateToInterpolated(state: PlayerState): InterpolatedPlayer {
    return {
      id: state.id,
      name: state.name,
      x: state.x,
      y: state.y,
      angle: state.angle,
      speed: state.speed,
      score: state.score,
      targetLength: state.targetLength,
      bodySegments: [...state.bodySegments],
      alive: state.alive,
      kills: state.kills,
    };
  }

  /**
   * Linear interpolation
   */
  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  /**
   * Angle interpolation (handles wraparound)
   */
  private lerpAngle(a: number, b: number, t: number): number {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }
}
