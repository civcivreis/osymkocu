type RpcError = {
  message?: string;
  code?: string;
  status?: number;
  hint?: string;
};

const missing = new Set<string>();

export function isMissingRpcError(error: RpcError | null | undefined) {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.status === 404) return true;
  const message = `${error.message ?? ''} ${error.hint ?? ''}`;
  return /could not find|schema cache|does not exist|PGRST202|not found|404/i.test(message);
}

export function markRpcMissing(name: string) {
  missing.add(name);
}

export function isRpcMissing(name: string) {
  return missing.has(name);
}

export function clearRpcMissing(name?: string) {
  if (name) missing.delete(name);
  else missing.clear();
}
