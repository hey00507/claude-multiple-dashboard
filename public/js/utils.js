export function todayStr() {
  return new Date().toISOString().split('T')[0];
}

export function formatDateLabel(dateStr) {
  const today = todayStr();
  const d = new Date(dateStr + 'T00:00:00');
  const weekday = d.toLocaleDateString('ko-KR', { weekday: 'short' });
  const label = `${d.getMonth() + 1}/${d.getDate()} (${weekday})`;
  return dateStr === today ? `오늘 — ${label}` : label;
}

export function formatDuration(ms) {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hrs}:${String(remainMins).padStart(2, '0')}:${String(remainSecs).padStart(2, '0')}`;
  }
  return `${mins}:${String(remainSecs).padStart(2, '0')}`;
}

export function htmlEscape(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function truncate(str, len) {
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

export function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
