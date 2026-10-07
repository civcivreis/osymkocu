import * as ImagePicker from 'expo-image-picker';
import { Alert, InteractionManager, Linking, Platform } from 'react-native';

export type PickedDeviceImage = {
  uri: string;
  base64: string;
  width?: number;
  height?: number;
  mime?: string;
};

export async function pickedImageFromFile(_file: unknown): Promise<PickedDeviceImage | null> {
  return null;
}

type Source = 'library' | 'camera';

function androidApi() {
  return Platform.OS === 'android' && typeof Platform.Version === 'number' ? Platform.Version : null;
}

function logPick(info: Record<string, unknown>) {
  if (__DEV__) {
    console.log('[pickDeviceImage]', {
      platform: Platform.OS,
      androidVersion: androidApi(),
      iosVersion: Platform.OS === 'ios' ? String(Platform.Version) : undefined,
      ...info,
    });
  }
}

function isLimited(permission: ImagePicker.MediaLibraryPermissionResponse) {
  return permission.accessPrivileges === 'limited';
}

function mediaOk(permission: ImagePicker.MediaLibraryPermissionResponse) {
  return permission.granted || permission.status === ImagePicker.PermissionStatus.GRANTED || isLimited(permission);
}

function needsLegacyStoragePermission() {
  const api = androidApi();
  return api != null && api < 33;
}

function showDenied(source: Source, canAskAgain: boolean) {
  const title = 'İzin gerekli';
  const body =
    source === 'camera'
      ? 'Fotoğraf çekmek için kamera izni lazım.'
      : 'Fotoğraf seçmek için galeri izni reddedildi.';
  if (!canAskAgain) {
    Alert.alert(title, `${body} Ayarlardan açabilirsin.`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Ayarları aç', onPress: () => void Linking.openSettings() },
    ]);
    return;
  }
  Alert.alert(title, body);
}

function waitForPresenter() {
  return new Promise<void>((resolve) => {
    InteractionManager.runAfterInteractions(() => {
      setTimeout(resolve, Platform.OS === 'ios' ? 50 : 0);
    });
  });
}

async function launchLibrary(options: ImagePicker.ImagePickerOptions) {
  console.log('[gallery] opening native picker', Platform.OS);
  await waitForPresenter();
  return ImagePicker.launchImageLibraryAsync({
    ...options,
    mediaTypes: ['images'],
    allowsEditing: false,
    legacy: false,
  });
}

async function openLibrary(options: ImagePicker.ImagePickerOptions) {
  console.log('[gallery] tap received');
  console.log('[gallery] platform', Platform.OS);
  logPick({ source: 'library', permissionStatus: 'skipped-photo-picker' });
  try {
    const picked = await launchLibrary(options);
    console.log('[gallery] picker result', {
      canceled: picked.canceled,
      uri: picked.canceled ? null : picked.assets[0]?.uri,
    });
    return picked;
  } catch (error) {
    console.error('[gallery] picker error', error);
    logPick({ source: 'library', permissionStatus: 'picker-threw', error: String(error) });
    if (!needsLegacyStoragePermission()) {
      Alert.alert('Fotoğraf seçilemedi', 'Sistem fotoğraf seçicisi açılamadı. Biraz sonra tekrar dene.');
      return null;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    logPick({
      source: 'library',
      permissionStatus: permission.status,
      granted: permission.granted,
      accessPrivileges: permission.accessPrivileges,
      canAskAgain: permission.canAskAgain,
    });
    if (!mediaOk(permission)) {
      showDenied('library', permission.canAskAgain);
      return null;
    }
    return launchLibrary(options);
  }
}

async function openCamera(options: ImagePicker.ImagePickerOptions) {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  logPick({
    source: 'camera',
    permissionStatus: permission.status,
    granted: permission.granted,
    canAskAgain: permission.canAskAgain,
  });
  if (!permission.granted) {
    showDenied('camera', permission.canAskAgain);
    return null;
  }
  return ImagePicker.launchCameraAsync({
    ...options,
    mediaTypes: ['images'],
  });
}

export async function pickDeviceImage(input: {
  source: Source;
  quality?: number;
  aspect?: [number, number];
  allowsEditing?: boolean;
}): Promise<PickedDeviceImage | null> {
  const options: ImagePicker.ImagePickerOptions = {
    quality: input.quality ?? 0.82,
    base64: true,
    exif: false,
    allowsEditing: input.source === 'camera' ? input.allowsEditing : false,
    aspect: input.source === 'camera' ? input.aspect : undefined,
  };
  const result = input.source === 'camera' ? await openCamera(options) : await openLibrary(options);
  if (!result || result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  logPick({
    source: input.source,
    permissionStatus: 'picked',
    selectedPhotoUri: asset.uri,
  });
  if (!asset.uri) {
    Alert.alert('Fotoğraf seçilemedi', 'Seçilen görsel okunamadı. Başka bir fotoğraf dene.');
    return null;
  }
  if (!asset.base64) {
    Alert.alert('Fotoğraf seçilemedi', 'Seçilen görsel okunamadı. Başka bir fotoğraf dene.');
    return null;
  }
  return {
    uri: asset.uri,
    base64: asset.base64,
    width: asset.width,
    height: asset.height,
    mime: asset.mimeType ?? undefined,
  };
}
