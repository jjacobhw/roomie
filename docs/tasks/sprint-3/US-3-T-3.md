---
id: US-3-T-3
story: US-3
sprint: 3
assignee: Nikhil Augustine
estimate_hours: 2
---

# Fix attachment uploads in group chat

## Description
Serves US-3 (input household expenses). This task covers when someone wants to upload a receipt for a shared cost, in order to split costs effectively

## Specs
- POST /conversations/:inviteCode/attachments with {"fileName":"pic.png","contentType":"image/png","sizeBytes":12345} uploads attachment to chat
- POST /attachments/:attachmentId/complete marks an upload of an attachment as complete
- GET /attachments/:attachmentId downloads files that were uploaded to the chat

## Requirements
- Use the existing group chat you're part of
- upload one attachment at a time
- attachment size can't be bigger than 100 MB

## Acceptance criteria
- An image can be uploaded successfully.
- A file can be uploaded succcessfully.
- There is confirmation indicating successful uploading.
