import { get, del, postMultipart } from './client'

export function fetchAttachments(ticketId) {
  return get(`/api/v1/tickets/${ticketId}/attachments`)
}

export function uploadAttachment(ticketId, file) {
  const formData = new FormData()
  formData.append('file', file)
  return postMultipart(`/api/v1/tickets/${ticketId}/attachments`, formData)
}

export function deleteAttachment(ticketId, attachmentId) {
  return del(`/api/v1/tickets/${ticketId}/attachments/${attachmentId}`)
}
