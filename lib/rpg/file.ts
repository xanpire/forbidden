export function downloadJson(filename: string, json: string) {
  if (typeof document === 'undefined') {
    return;
  }

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function downloadImage(filename: string, dataUri: string) {
  if (typeof document === 'undefined') {
    return;
  }

  const [meta, data] = dataUri.split(',');
  const mimeType = /data:([^;]+)/.exec(meta)?.[1] ?? 'image/jpeg';

  try {
    const binary = window.atob(data);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  } catch {
    const anchor = document.createElement('a');

    anchor.href = dataUri;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }
}

export function pickJsonFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('File import is only available in the web app.'));
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';

    input.onchange = () => {
      const file = input.files?.[0];

      if (!file) {
        reject(new Error('No save file selected.'));
        return;
      }

      const reader = new FileReader();

      reader.onload = () => {
        resolve(String(reader.result ?? ''));
      };

      reader.onerror = () => {
        reject(new Error('Could not read that save file.'));
      };

      reader.readAsText(file);
      document.body.removeChild(input);
    };

    document.body.appendChild(input);
    input.click();
  });
}
