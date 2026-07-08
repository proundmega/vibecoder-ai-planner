import { get, del, postMultipart } from './client'

export interface Attachment {
  id: string
  ticket_id: string
  filename: string
  size: number
  mime_type: string
  uploaded_at: string
}

export function fetchAttachments(ticketId: string): Promise<Attachment[]> {
  return get(`/api/v1/tickets/${ticketId}/attachments`)
}

export function uploadAttachment(ticketId: string, file: File): Promise<Attachment> {
  const formData = new FormData()
  formData.append('file', file)
  return postMultipart(`/api/v1/tickets/${ticketId}/attachments`, formData)
}

export function deleteAttachment(ticketId: string, attachmentId: string): Promise<void> {
  return del(`/api/v1/tickets/${ticketId}/attachments/${attachmentId}`)
}
