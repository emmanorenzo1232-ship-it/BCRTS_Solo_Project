import ExcelJS from 'exceljs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCaseWorkbook, downloadCasesReport } from '../caseReport'
import type { CaseRecord, CaseStatus } from '../types'

const generatedAt = new Date('2026-10-25T16:05:00Z')
const filters = { search: 'drainage', status: 'all', type: 'all' } as const
const statuses: CaseStatus[] = ['Received', 'In Progress', 'Resolved', 'Closed']
const cases: CaseRecord[] = statuses.map((status, index) => ({
  id: index + 1, reference_number: `BCRTS-2026-00${index}`, resident_id: 1,
  type: 'complaint', category: 'Drainage', subject: ['=1+1', '+SUM(A1)', '-1+2', '@SUM(A1)'][index],
  description: 'Baradong kanal sa tabi ng bahay.\nKailangan ng tulong, salamat po!\n' + 'Mahabang paglalarawan. '.repeat(12),
  status, created_at: '2026-10-25T16:05:00', updated_at: '2026-10-25T16:05:00Z',
  appointment_date: null, appointment_time: null, appointment_status: null,
  resident: { id: 1, name: 'José Dela Peña', email: 'jose@example.com' },
}))

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function roundTrip(items = cases) {
  const workbook = createCaseWorkbook(items, filters, generatedAt)
  const saved = new ExcelJS.Workbook()
  await saved.xlsx.load(await workbook.xlsx.writeBuffer())
  return saved.getWorksheet('Cases')!
}

describe('Excel case report', () => {
  it('preserves every column, row order, multiline text, Unicode, and literal formula-like values', async () => {
    const sheet = await roundTrip()
    expect(sheet.rowCount).toBe(11)
    expect(sheet.getRow(7).values).toEqual([undefined, 'Reference', 'Resident', 'Email', 'Type', 'Category', 'Subject', 'Description', 'Status', 'Submitted'])
    cases.forEach((item, index) => {
      const row = sheet.getRow(index + 8)
      expect(row.values).toEqual([undefined, item.reference_number, item.resident.name, item.resident.email,
        item.type, item.category, item.subject, item.description, item.status, new Date('2026-10-26T00:05:00Z')])
      expect(row.getCell(6).type).toBe(ExcelJS.ValueType.String)
      expect(row.getCell(6).formula).toBeUndefined()
      expect(row.height).toBeGreaterThan(48)
      expect(row.getCell(7).alignment.wrapText).toBe(true)
    })
  })

  it('writes report metadata, styles, frozen headers, filters, and print settings', async () => {
    const sheet = await roundTrip()
    expect(sheet.getCell('A1').value).toBe('BCRTS — Case Report')
    expect(sheet.getCell('A1').font).toMatchObject({ name: 'Calibri', size: 20, bold: true })
    expect(sheet.getCell('A1').fill).toMatchObject({ fgColor: { argb: 'FF174C42' } })
    expect(sheet.getCell('A3').value).toContain('26 Oct 2026')
    expect(sheet.getCell('A3').value).toContain('Philippine time (UTC+8)')
    expect(sheet.getCell('A4').value).toBe('Exported cases: 4 | Status: All statuses | Type: All types')
    expect(sheet.getCell('A5').value).toBe('Search: drainage')
    expect(sheet.getCell('A7').font.color).toEqual({ argb: 'FFFFFFFF' })
    expect(sheet.getCell('A8').fill).toMatchObject({ fgColor: { argb: 'FFFFFFFF' } })
    expect(sheet.getCell('A9').fill).toMatchObject({ fgColor: { argb: 'FFEDF4F0' } })
    expect(statuses.map((_, index) => (sheet.getCell(`H${index + 8}`).fill as ExcelJS.FillPattern).fgColor?.argb))
      .toEqual(['FFE8EEF6', 'FFFFF2CF', 'FFE1F2E7', 'FFE8ECEA'])
    expect(sheet.getCell('I8').type).toBe(ExcelJS.ValueType.Date)
    expect(sheet.getCell('I8').numFmt).toBe('dd mmm yyyy, hh:mm')
    expect(sheet.getColumn(7).width).toBeGreaterThan(sheet.getColumn(2).width!)
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 7, topLeftCell: 'B8', showGridLines: false })
    expect(sheet.autoFilter).toBe('A7:I11')
    expect(sheet.pageSetup).toMatchObject({ paperSize: 9, orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, printTitlesRow: '7:7', printArea: 'A1:I11' })
    expect(sheet.headerFooter.oddFooter).toContain('Page &P of &N')
  })

  it('handles explicit offsets and UTC dates consistently across Philippine midnight', async () => {
    const items = ['2026-10-25T15:59:00Z', '2026-10-25T16:00:00Z', '2026-10-26T00:00:00+08:00', '2026-10-25T16:00:00']
      .map((created_at) => ({ ...cases[0], created_at }))
    const sheet = await roundTrip(items)
    expect(sheet.getCell('I8').value).toEqual(new Date('2026-10-25T23:59:00Z'))
    for (const row of [9, 10, 11]) expect(sheet.getCell(`I${row}`).value).toEqual(new Date('2026-10-26T00:00:00Z'))
  })

  it('labels selected filters and safely handles a header-only report', async () => {
    const workbook = createCaseWorkbook([], { search: ' =1+1 ', status: 'Closed', type: 'request' }, generatedAt)
    const saved = new ExcelJS.Workbook()
    await saved.xlsx.load(await workbook.xlsx.writeBuffer())
    const sheet = saved.getWorksheet('Cases')!
    expect(sheet.getCell('A4').value).toBe('Exported cases: 0 | Status: Closed | Type: Requests')
    expect(sheet.getCell('A5').value).toBe('Search: =1+1')
    expect(sheet.autoFilter).toBe('A7:I7')
    expect(sheet.rowCount).toBe(7)
    expect(createCaseWorkbook([], { ...filters, search: '' }, generatedAt).getWorksheet('Cases')!.getCell('A5').value).toBe('Search: All cases')
  })

  it('creates an XLSX download with the Philippine date and releases its resources', async () => {
    const link = document.createElement('a')
    const click = vi.spyOn(link, 'click').mockImplementation(() => {})
    const remove = vi.spyOn(link, 'remove')
    vi.spyOn(document, 'createElement').mockReturnValue(link)
    const append = vi.spyOn(document.body, 'append')
    const createUrl = vi.fn((_blob: Blob) => 'blob:report')
    const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revoke })
    const timers = vi.spyOn(globalThis, 'setTimeout')
    await downloadCasesReport(cases, filters, generatedAt)
    expect(link.download).toBe('bcrts-cases-2026-10-26.xlsx')
    expect(link.href).toBe('blob:report')
    expect(append).toHaveBeenCalledWith(link)
    expect(click).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
    expect(link.isConnected).toBe(false)
    expect(createUrl.mock.calls[0][0]).toBeInstanceOf(Blob)
    expect((createUrl.mock.calls[0][0] as Blob).type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(timers).toHaveBeenCalledWith(expect.any(Function), 1000)
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:report'), { timeout: 2000 })
  })

  it('cleans up the download even if clicking fails', async () => {
    const link = document.createElement('a')
    vi.spyOn(link, 'click').mockImplementation(() => { throw new Error('Download failed') })
    const remove = vi.spyOn(link, 'remove')
    vi.spyOn(document, 'createElement').mockReturnValue(link)
    const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:failed-report'), revokeObjectURL: revoke })
    await expect(downloadCasesReport(cases, filters, generatedAt)).rejects.toThrow('Download failed')
    expect(remove).toHaveBeenCalledOnce()
    expect(link.isConnected).toBe(false)
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:failed-report'), { timeout: 2000 })
  })
})
