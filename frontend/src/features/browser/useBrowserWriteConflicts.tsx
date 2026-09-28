import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "../../components/Modal";
import { ListActionButton } from "../../components/list/ListControls";
import { formatBytes } from "../../utils/format";
import { inspectBrowserDestinations, type BrowserDestinationObservation, type BrowserWriteGuard } from "../../api/browserConflicts";
import type { S3AccountSelector } from "../../api/accountParams";
import type { BrowserRequestOptions } from "../../api/browserWorkspace";

export type BrowserWriteTarget = { id: string; key: string; size?: number; modified?: string };
export type PreparedBrowserWrite = BrowserWriteTarget & { writeGuard: BrowserWriteGuard };
export type PrepareBrowserWrites = (targets: BrowserWriteTarget[], bucket?: string) => Promise<PreparedBrowserWrite[]>;
type Choice = "replace" | "skip" | "keep";
type Conflict = { target: BrowserWriteTarget; destination: BrowserDestinationObservation; duplicate: boolean };
type Dialog = { conflicts: Conflict[]; protection: string; finish: (choices: Record<string, Choice> | null) => void };

export function numberedBrowserKey(key: string, number: number) {
  const slash = key.lastIndexOf("/");
  const dot = key.lastIndexOf(".");
  const split = dot > slash + 1 ? dot : key.length;
  return `${key.slice(0, split)} (${number})${key.slice(split)}`;
}

export function useBrowserWriteConflicts(account: S3AccountSelector, bucket: string, options: BrowserRequestOptions | undefined, sseKey: string | null, versioning: boolean) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const pending = useRef<Dialog | null>(null);
  const serial = useRef<Promise<unknown>>(Promise.resolve());
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; pending.current?.finish(null); pending.current = null; }, [account, bucket]);
  const prepare: PrepareBrowserWrites = useCallback((targets, destinationBucket = bucket) => {
    const generationAtStart = generation.current;
    const run = async () => {
      const observations = new Map<string, BrowserDestinationObservation>();
      let protection = "preflight";
      for (let offset = 0; offset < targets.length; offset += 200) {
        const result = await inspectBrowserDestinations(account, destinationBucket, targets.slice(offset, offset + 200).map((target) => target.key), options, sseKey);
        protection = result.protection;
        result.objects.forEach((item) => observations.set(item.key, item));
      }
      if (generation.current !== generationAtStart) return [];
      const seen = new Set<string>();
      const conflicts: Conflict[] = [];
      for (const target of targets) {
        const destination = observations.get(target.key);
        if (!destination) throw new Error("Incomplete destination inspection; nothing was written.");
        const duplicate = seen.has(target.key);
        if (destination.exists || duplicate) conflicts.push({ target, destination, duplicate });
        seen.add(target.key);
      }
      let decisions: Record<string, Choice> = {};
      if (conflicts.length) {
        const result = await new Promise<Record<string, Choice> | null>((resolve) => {
          const next: Dialog = { conflicts, protection, finish: (value) => { setDialog(null); pending.current = null; resolve(value); } };
          setChoices({}); pending.current = next; setDialog(next);
        });
        if (!result || generation.current !== generationAtStart) return [];
        decisions = result;
      }
      const reserved = new Set(targets.map((target) => target.key));
      const prepared: PreparedBrowserWrite[] = [];
      for (const target of targets) {
        if (decisions[target.id] === "skip") continue;
        let key = target.key;
        let observed = observations.get(key)!;
        if (decisions[target.id] === "keep") {
          let found = false;
          for (let number = 1; number <= 1000; number++) {
            key = numberedBrowserKey(target.key, number);
            if (reserved.has(key)) continue;
            const result = await inspectBrowserDestinations(account, destinationBucket, [key], options, sseKey);
            observed = result.objects[0];
            if (observed && !observed.exists) { found = true; break; }
          }
          if (!found) throw new Error("No available numbered destination. Choose another name.");
        }
        reserved.add(key);
        prepared.push({ ...target, key, writeGuard: { exists: observed.exists, etag: observed.etag } });
      }
      return generation.current === generationAtStart ? prepared : [];
    };
    const result = serial.current.then(run, run);
    serial.current = result.catch(() => undefined);
    return result;
  }, [account, bucket, options, sseKey]);
  const conflictDialog = dialog && <Modal title="Resolve destination conflicts" onClose={() => dialog.finish(null)}>
    <p className="mb-3 ui-caption">{versioning ? "Replacing an object creates a new current version." : "Replacing may permanently overwrite the current object; versioning is not confirmed."}</p>
    <p className="mb-3 ui-caption">{dialog.protection === "conditional" ? "Writes will check that the destination has not changed." : "This provider uses a preflight check. Concurrent changes cannot be excluded atomically."}</p>
    <div className="mb-3 flex flex-wrap gap-2">{(["replace", "skip", "keep"] as Choice[]).map((choice) => <ListActionButton key={choice} onClick={() => setChoices(Object.fromEntries(dialog.conflicts.filter((conflict) => choice !== "replace" || !conflict.duplicate).map((conflict) => [conflict.target.id, choice])))}>{choice === "replace" ? "Replace all" : choice === "skip" ? "Skip all" : "Keep both for all"}</ListActionButton>)}</div>
    <div className="max-h-96 overflow-auto"><table className="ui-data-table"><thead><tr><th>Destination</th><th>Incoming</th><th>Existing</th><th>Decision</th></tr></thead><tbody>{dialog.conflicts.map(({ target, destination, duplicate }) => <tr key={target.id}>
      <td className="break-all">{target.key}{duplicate && <p>Duplicate target in this batch</p>}</td>
      <td>{target.size == null ? "Unknown size" : formatBytes(target.size)}<p>{target.modified || ""}</p></td>
      <td>{destination.size == null ? "Unknown size" : formatBytes(destination.size)}<p>{destination.modified || ""}</p></td>
      <td><select className="ui-control" aria-label={`Decision for ${target.key}`} value={choices[target.id] || ""} onChange={(event) => setChoices((previous) => ({ ...previous, [target.id]: event.target.value as Choice }))}>
        <option value="" disabled>Choose…</option><option value="replace" disabled={duplicate}>Replace</option><option value="skip">Skip</option><option value="keep">Keep both</option>
      </select></td>
    </tr>)}</tbody></table></div>
    <div className="mt-3 flex justify-end gap-2"><ListActionButton onClick={() => dialog.finish(null)}>Cancel batch</ListActionButton><ListActionButton variant="primary" disabled={dialog.conflicts.some(({ target }) => !choices[target.id])} onClick={() => dialog.finish(choices)}>Apply decisions</ListActionButton></div>
  </Modal>;
  return { prepare, conflictDialog };
}
