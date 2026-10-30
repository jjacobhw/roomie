// son

export interface ChoreItem {
    id: string;
    listId: string;
    text: string;
    isDone: boolean;
}

export interface ChoreList {
    id: string;
    conversationId: string; // Ties the list directly to an active chat/conversation
    title: string;
    items: ChoreItem[];
}

export function addList(conversationId: string, title: string): void {
    const token = localStorage.getItem('chat_auth_token');
    const payload = {conversationId, title};

    fetch('/api/lists', {
        method: 'POST',
        headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    })
    .then((response) => {
        if (!response.ok) throw new Error('Failed to create list');
        return response.json();
    })
    .then((result) => {
        console.log('List created successfully:', result.data);
    })
    .catch((error) => console.error('Error adding list:', error));
}

export function updateListItemDone(listId: string, itemId: string): void {
    const token = localStorage.getItem('chat_auth_token');
  
    fetch(`/api/lists/${listId}/items/${itemId}/done`, {
        method: 'PATCH', // PATCH is preferred in REST APIs for partial updates
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then((response) => {
        if (!response.ok) throw new Error('Failed to mark item as complete');
        console.log(`Item ${itemId} marked as complete.`);
    })
    .catch((error) => console.error('Error updating item status:', error));
}
  
export function updateListItemNotDone(listId: string, itemId: string): void {
    const token = localStorage.getItem('chat_auth_token');
  
    fetch(`/api/lists/${listId}/items/${itemId}/notdone`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then((response) => {
        if (!response.ok) throw new Error('Failed to mark item as incomplete');
        console.log(`Item ${itemId} marked as incomplete.`);
    })
    .catch((error) => console.error('Error updating item status:', error));
}

export function deleteChoreItem(itemId: string): void {
    const token = localStorage.getItem('chat_auth_token');
    const activeUserId = localStorage.getItem('chat_user_id') || 'unknown';
  
    fetch(`/api/chores/items/${itemId}`, {
        method: 'DELETE', // DELETE requests don't need a body payload; the URL param tells the server what to drop
        headers: {
        'Authorization': `Bearer ${token}`
        }
    })
    .then((response) => {
        if (!response.ok) {throw new Error(`Failed to delete item. Server returned ${response.status}`);}
        return response.json();
    })
    .then(() => {
        console.log(`Chore item ${itemId} successfully purged by user ${activeUserId}.`);
    })
    .catch((error) => {
        console.error(`Deletion pipeline failure for user ${activeUserId}:`, error);
    });
}

