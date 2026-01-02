import type { GameSnapshot, PlayerState } from '@shared/types';
import { GAME_CONFIG } from '../config';

/**
 * Interpolated player state at a specific render time
 */
export interface InterpolatedPlayer {
  id: string;
  x: number;
  y: number;
  angle: number;
  speed: number;
  score: number;
  bodySegments: Array<{ x: number; y: number }>;
}

/**
 * SnapshotInterpolation manages a buffer of server snapshots
 * and provides smooth interpolation between them for rendering
 * other players without jitter.
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
   * Get interpolated states for all players at current render time
   */
  getInterpolatedPlayers(excludePlayerId?: string): Map<string, InterpolatedPlayer> {
    const result = new Map<string, InterpolatedPlayer>();
    const renderTime = this.getRenderTime();

    // Find the two snapshots to interpolate between
    const { before, after, t } = this.findInterpolationSnapshots(renderTime);

    if (!before) {
      // No snapshots yet, return empty
      return result;
    }

    if (!after) {
      // Only have one snapshot (or render time is past all snapshots)
      // Use the latest available state
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
        // Player just joined, use their current state
        result.set(id, this.playerStateToInterpolated(playerAfter));
        continue;
      }

      // Interpolate position and angle
      result.set(id, this.interpolatePlayer(playerBefore, playerAfter, t));
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

    // Find snapshots that bracket the render time
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

    // Calculate interpolation factor
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
      x: this.lerp(before.x, after.x, t),
      y: this.lerp(before.y, after.y, t),
      angle: this.lerpAngle(before.angle, after.angle, t),
      speed: this.lerp(before.speed, after.speed, t),
      score: after.score, // Don't interpolate score
      bodySegments: this.interpolateBodySegments(before.bodySegments, after.bodySegments, t),
    };
  }

  /**
   * Interpolate body segments
   */
  private interpolateBodySegments(
    before: Array<{ x: number; y: number }>,
    after: Array<{ x: number; y: number }>,
    t: number
  ): Array<{ x: number; y: number }> {
    const result: Array<{ x: number; y: number }> = [];
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
      x: state.x,
      y: state.y,
      angle: state.angle,
      speed: state.speed,
      score: state.score,
      bodySegments: [...state.bodySegments],
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
    // Normalize angles to -PI to PI
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }
}

