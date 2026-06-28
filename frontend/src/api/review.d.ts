export interface DiffFile {
  filename: string
  status: string
  patch: string
  additions: number
  deletions: number
}

export function getGithubDiff(ticketId: string): Promise<{ files: DiffFile[] }>
export function getLocalDiff(ticketId: string): Promise<{ files: any[] }>
export function getComments(ticketId: string, type?: string): Promise<any[]>
export function postComment(ticketId: string, data: { content: string; file_path?: string; line_number?: number }): Promise<any>
export function postLocalDiff(ticketId: string, files: any[]): Promise<any>
