import type { Account, Institution, Overview } from "@kerfin/core";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { engine } from "./engine";

interface Data {
  overview: Overview | null;
  institutions: Institution[];
  refresh: () => Promise<void>;
  institutionName: (id: string | null) => string;
  /** Where an account is held, for grouping and display. */
  accountInstitution: (account: Account) => string;
}

const DataContext = createContext<Data | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [institutions, setInstitutions] = useState<Institution[]>([]);

  const refresh = useCallback(async () => {
    try {
      setOverview(await engine.overview());
    } catch {
      // Locked or unreachable: App shows the right screen.
    }
  }, []);

  useEffect(() => {
    void refresh();
    engine.institutions().then(setInstitutions, () => undefined);
  }, [refresh]);

  const value = useMemo<Data>(() => {
    const names = new Map(institutions.map((i) => [i.id, i.name]));
    const institutionName = (id: string | null) => (id ? (names.get(id) ?? id) : "");
    return {
      overview,
      institutions,
      refresh,
      institutionName,
      accountInstitution: (account) =>
        account.institution_name ?? institutionName(account.institution) ?? "",
    };
  }, [overview, institutions, refresh]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): Data {
  const data = useContext(DataContext);
  if (!data) throw new Error("useData outside DataProvider");
  return data;
}
