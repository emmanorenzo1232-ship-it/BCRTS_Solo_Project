import ExcelJS from 'exceljs'
import type { CaseRecord, CaseStatus, CaseType } from './types'

export interface CaseReportFilters {
  search: string
  status: CaseStatus | 'all'
  type: CaseType | 'all'
}

const PHILIPPINE_OFFSET = 8 * 60 * 60 * 1000
const HEADER_ROW = 7
const widths = [25, 25, 34, 14, 22, 36, 60, 18, 24]
const columns = ['Reference', 'Resident', 'Email', 'Type', 'Category', 'Subject', 'Description', 'Status', 'Submitted']
const statusColors: Record<CaseStatus, [string, string]> = {
  Received: ['FFE8EEF6', 'FF345984'],
  'In Progress': ['FFFFF2CF', 'FF84620B'],
  Resolved: ['FFE1F2E7', 'FF286746'],
  Closed: ['FFE8ECEA', 'FF52615C'],
}

function fill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

function wrappedLines(text: string, width: number) {
  // Leave room for cell padding and wide glyphs; Excel caps row heights at 409.5pt.
  return text.split(/\r\n|\r|\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / (width * 0.85))), 0)
}

function philippineDate(value: string) {
  // SQLite can return UTC timestamps without an explicit offset.
  const utcValue = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`
  const timestamp = new Date(utcValue).getTime()
  if (!Number.isFinite(timestamp)) throw new Error('Invalid case submission date.')
  // Excel dates have no time zone: encode the Philippine wall-clock time.
  return new Date(timestamp + PHILIPPINE_OFFSET)
}

export function createCaseWorkbook(cases: readonly CaseRecord[], filters: CaseReportFilters, generatedAt: Date) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'BCRTS'
  workbook.created = generatedAt
  workbook.modified = generatedAt
  const sheet = workbook.addWorksheet('Cases', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: HEADER_ROW, topLeftCell: 'B8', showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
      margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
    headerFooter: { oddFooter: '&LBCRTS — Case Report&RPage &P of &N' },
  })
  sheet.columns = widths.map((width) => ({ width }))

  const generated = new Date(generatedAt.getTime() + PHILIPPINE_OFFSET)
  const generatedLabel = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(generated)
  const metadata = [
    'BCRTS — Case Report',
    'Barangay Complaint and Request Tracking System',
    `Generated: ${generatedLabel} | All timestamps: Philippine time (UTC+8)`,
    `Exported cases: ${cases.length} | Status: ${filters.status === 'all' ? 'All statuses' : filters.status} | Type: ${filters.type === 'all' ? 'All types' : filters.type === 'complaint' ? 'Complaints' : 'Requests'}`,
    `Search: ${filters.search.trim() || 'All cases'}`,
  ]
  metadata.forEach((text, index) => {
    const row = sheet.getRow(index + 1)
    sheet.mergeCells(index + 1, 1, index + 1, columns.length)
    const cell = row.getCell(1)
    cell.value = text
    cell.font = { name: 'Calibri', size: index === 0 ? 20 : 11, bold: index === 0, color: { argb: index < 2 ? 'FFFFFFFF' : 'FF17352F' } }
    cell.fill = fill(index < 2 ? 'FF174C42' : 'FFF4F6F1')
    cell.alignment = { vertical: 'middle', wrapText: true, indent: 1 }
    row.height = index === 0 ? 36 : Math.min(409.5, Math.max(25, wrappedLines(text, widths.reduce((a, b) => a + b, 0)) * 16 + 10))
  })
  sheet.getRow(6).height = 10
  const header = sheet.getRow(HEADER_ROW)
  header.values = columns
  header.height = 30
  header.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = fill('FF174C42')
    cell.alignment = { vertical: 'middle', wrapText: true }
    cell.border = { bottom: { style: 'medium', color: { argb: 'FFD4A72C' } } }
  })

  cases.forEach((item, index) => {
    const values = [item.reference_number, item.resident.name, item.resident.email, item.type,
      item.category, item.subject, item.description, item.status, philippineDate(item.created_at)]
    const row = sheet.addRow(values)
    row.height = Math.min(409.5, Math.max(32, ...values.map((value, column) =>
      wrappedLines(typeof value === 'string' ? value : '25 Oct 2026, 23:45', widths[column]) * 16 + 10)))
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      // Plain string values stay literal in XLSX, including leading =, +, -, or @.
      cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF17352F' } }
      cell.fill = fill(index % 2 === 0 ? 'FFFFFFFF' : 'FFEDF4F0')
      cell.alignment = { vertical: 'top', wrapText: true }
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFDCE4DE' } } }
      if (column === 8) {
        const [background, foreground] = statusColors[item.status]
        cell.fill = fill(background)
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: foreground } }
      }
      if (column === 9) cell.numFmt = 'dd mmm yyyy, hh:mm'
    })
  })
  sheet.autoFilter = `A${HEADER_ROW}:I${Math.max(HEADER_ROW, sheet.rowCount)}`
  sheet.pageSetup.printArea = `A1:I${sheet.rowCount}`
  return workbook
}

export async function downloadCasesReport(cases: readonly CaseRecord[], filters: CaseReportFilters, generatedAt: Date) {
  const workbook = createCaseWorkbook(cases, filters, generatedAt)
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  let link: HTMLAnchorElement | undefined
  try {
    link = document.createElement('a')
    link.href = url
    const date = new Date(generatedAt.getTime() + PHILIPPINE_OFFSET).toISOString().slice(0, 10)
    link.download = `bcrts-cases-${date}.xlsx`
    document.body.append(link)
    link.click()
  } finally {
    link?.remove()
    // Give the browser time to begin reading the download before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
