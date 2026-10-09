export function csvRow(fields: string[]): string {
  return fields.map((field) => `"${field.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`).join(',')
}
