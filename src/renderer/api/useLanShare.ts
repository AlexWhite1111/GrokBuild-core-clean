import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LanShareStatus } from "../../shared/contracts.js";

const QUERY_KEY = ["shell", "lan-share"] as const;

export function useLanShare() {
  const client = useQueryClient();
  const available = Boolean(window.grokDesktop);
  const status = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => window.grokDesktop!.getLanShareStatus(),
    enabled: available,
    staleTime: Infinity,
  });
  useEffect(() => window.grokDesktop?.onLanShareChanged((next) => {
    client.setQueryData<LanShareStatus>(QUERY_KEY, next);
  }), [client]);
  const setEnabled = useMutation({
    mutationFn: (enabled: boolean) => window.grokDesktop!.setLanShare({ enabled }),
    onSuccess: (next) => client.setQueryData<LanShareStatus>(QUERY_KEY, next),
  });
  return { available, status, setEnabled };
}
