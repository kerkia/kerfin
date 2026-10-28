// Finary data is refreshed each time the vault is unlocked, so the dashboards are current.
import { useEffect, useRef } from "react";

import { useData } from "../data";
import { engine } from "../engine";
import { useJobs } from "./Jobs";

export function RefreshOnStart() {
  const { overview } = useData();
  const { track } = useJobs();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !overview) return;
    started.current = true;
    for (const connection of overview.connections.filter((c) => c.institution === "finary")) {
      engine.sync(connection.id).then(
        (job) => track(job, connection.label),
        () => undefined,
      );
    }
  }, [overview, track]);

  return null;
}
