export async function saveAuthorizationAndRefresh<T>(
  save: () => Promise<T>,
  refresh: (receipt: T) => Promise<void>,
): Promise<{ status: 'saved_refreshed' | 'saved_refresh_pending'; receipt: T }> {
  const receipt = await save();
  try {
    await refresh(receipt);
  } catch {
    // The mutation has committed. Never retry it as a response to a read failure.
    return { status: 'saved_refresh_pending', receipt };
  }
  return { status: 'saved_refreshed', receipt };
}
