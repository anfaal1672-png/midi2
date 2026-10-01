export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function saveText(text: string, fileName: string, type = 'application/json') {
  saveBlob(new Blob([text], { type }), fileName);
}

export function pickFile(accept: string, multiple = false, directory = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    if (directory) (input as any).webkitdirectory = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'midi';
