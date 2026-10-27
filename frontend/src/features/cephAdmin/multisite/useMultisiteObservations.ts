/* Copyright (c) 2026 Laurent Barbe; Licensed under the Apache License, Version 2.0 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MultisiteObservation, MultisiteSyncStatus } from "../../../api/cephMultisite";

type Change = "first_observation" | "new_context" | "changed" | "unchanged";
type Sample = {
  collected_at: string;
  received_at: number;
  context: string;
  change: Change;
  phase: string;
  raw_status: string | null;
  shards: { shard_id: number; marker: string | null; phase: string; raw_status: string | number | null; change: Change }[];
};

/** A session-only equality comparison. Positions remain opaque strings. */
export function compareMultisiteObservation(
  previous: Sample | undefined,
  observation: MultisiteObservation<MultisiteSyncStatus>,
  identityScope: string,
  now = Date.now(),
): Sample | null {
  if (observation.availability !== "available" || observation.stale || !observation.data) return null;
  const data = observation.data;
  const provenance = observation.provenance;
  const context = JSON.stringify([
    identityScope, provenance.endpoint_id, provenance.realm_id, provenance.local_zone_id,
    provenance.source_zone_id, data.family, data.period, data.realm_epoch, data.instance_id, data.generation,
  ]);
  const recent = previous && now - previous.received_at <= 30 * 60 * 1000 ? previous : undefined;
  const initial: Change | null = !recent ? "first_observation" : recent.context !== context ? "new_context" : null;
  const before = new Map(recent?.shards.map((shard) => [shard.shard_id, shard]));
  const shards = data.shards.map((shard) => {
    const old = before.get(shard.shard_id);
    const change: Change = initial ?? (!old ? "first_observation" : old.marker === shard.marker && old.phase === shard.phase && old.raw_status === shard.raw_status ? "unchanged" : "changed");
    return { shard_id: shard.shard_id, marker: shard.marker, phase: shard.phase, raw_status: shard.raw_status, change };
  });
  return {
    collected_at: observation.collected_at, received_at: now, context, shards, phase: data.phase, raw_status: data.raw_status,
    change: initial ?? (data.phase !== recent?.phase || data.raw_status !== recent?.raw_status || shards.some((shard) => shard.change !== "unchanged") || recent?.shards.length !== shards.length ? "changed" : "unchanged"),
  };
}

export function useMultisiteObservations(scope: string) {
  const store = useRef<{ scope: string; observations: Sample[] }>({ scope, observations: [] });
  const [snapshot, setSnapshot] = useState(store.current);
  // Gate synchronously on scope: a render after navigation never shows the
  // previous bucket or endpoint while waiting for an effect to clean up.
  const observations = snapshot.scope === scope ? snapshot.observations : [];
  useEffect(() => {
    if (store.current.scope !== scope) {
      store.current = { scope, observations: [] };
      setSnapshot(store.current);
      return;
    }
    const oldest = snapshot.observations[0];
    if (!oldest) return;
    const timer = window.setTimeout(() => {
      if (store.current.scope !== scope) return;
      store.current = { scope, observations: store.current.observations.filter((entry) => Date.now() - entry.received_at < 1800000) };
      setSnapshot(store.current);
    }, Math.max(1, oldest.received_at + 1800000 - Date.now()));
    return () => window.clearTimeout(timer);
  }, [scope, snapshot]);
  const record = useCallback((observation: MultisiteObservation<MultisiteSyncStatus>, identityScope = scope) => {
    const now = Date.now();
    const previous = store.current.scope === scope ? store.current.observations.filter((entry) => now - entry.received_at <= 1800000) : [];
    const next = compareMultisiteObservation(previous.at(-1), observation, identityScope, now);
    if (!next || previous.at(-1)?.collected_at === next.collected_at) return;
    store.current = { scope, observations: [...previous, next].slice(-20) };
    setSnapshot(store.current);
  }, [scope]);
  const reset = useCallback(() => {
    store.current = { scope, observations: [] };
    setSnapshot(store.current);
  }, [scope]);
  return { observations, record, reset };
}
