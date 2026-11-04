export interface Row {
  id: number;
  name: string;
}

const ID_WIDTH = 6;
const NAME_WIDTH = 12;

function pad(text: string, width: number): string {
  if (text.length >= width) {
    return text.slice(0, width);
  }
  return text + ' '.repeat(width - text.length);
}

export function formatHeader(): string {
  return pad('ID', ID_WIDTH) + ' ' + pad('NAME', NAME_WIDTH);
}

export function formatRow(row: Row): string {
  return pad(String(row.id), ID_WIDTH) + ' ' + pad(row.name, NAME_WIDTH);
}

export function isEmpty(row: Row): boolean {
  return row.name.trim() === '';
}
