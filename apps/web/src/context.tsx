import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api.js";
import type { PublicConfiguration } from "./types.js";

interface ConfigContextValue {
  config: PublicConfiguration | null;
  error: string;
}

const ConfigContext = createContext<ConfigContextValue>({
  config: null,
  error: "",
});

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfiguration | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<PublicConfiguration>("/api/config")
      .then((value) => {
        if (active) setConfig(value);
      })
      .catch(() => {
        if (active)
          setError("Gifts in Service could not start. Please try again.");
      });
    return () => {
      active = false;
    };
  }, []);
  const value = useMemo(() => ({ config, error }), [config, error]);
  return (
    <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
  );
}

export function useConfig(): PublicConfiguration {
  const { config, error } = useContext(ConfigContext);
  if (error) throw new Error(error);
  // React Suspense uses a thrown promise to retry after asynchronous configuration loads.
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  if (!config) throw new Promise((resolve) => setTimeout(resolve, 50));
  return config;
}
