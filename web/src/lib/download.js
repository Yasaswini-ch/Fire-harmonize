// Browser-only helper: hand a Blob to the user as a file.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const downloadText = (text, filename) => downloadBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), filename);
