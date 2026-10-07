export type PickedDeviceImage = {
  uri: string;
  base64: string;
  width?: number;
  height?: number;
  mime?: string;
};

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function pickedImageFromFile(file: File): Promise<PickedDeviceImage | null> {
  if (!file.type.startsWith('image/')) return null;
  const base64 = await fileToBase64(file);
  return {
    uri: URL.createObjectURL(file),
    base64,
    mime: file.type || 'image/jpeg',
  };
}

export async function pickDeviceImage(_input: {
  source: 'library' | 'camera';
  quality?: number;
  aspect?: [number, number];
  allowsEditing?: boolean;
}): Promise<PickedDeviceImage | null> {
  if (typeof document === 'undefined') return null;
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    const cleanup = () => {
      input.remove();
    };
    input.onchange = () => {
      const file = input.files?.[0];
      cleanup();
      if (!file) {
        resolve(null);
        return;
      }
      void pickedImageFromFile(file).then(resolve);
    };
    input.oncancel = () => {
      cleanup();
      resolve(null);
    };
    document.body.appendChild(input);
    input.click();
  });
}
