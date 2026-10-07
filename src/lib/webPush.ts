/** Native: no web-push APIs. Keep native Expo notifications separate. */
export function isWebPushSupported() {
  return false;
}

export async function enableWebPush(): Promise<{ ok: boolean; message: string }> {
  return { ok: false, message: 'Web bildirimleri yalnızca tarayıcıda açılır.' };
}

export async function disableWebPush(): Promise<void> {}
