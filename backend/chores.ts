/**
 * Roomie Chores Module
 * This module provides functions to manage chore lists and items within the Roomie application.
 * It includes interfaces for ChoreItem and ChoreList, as well as functions to add lists, 
 * update item statuses, and delete items.
 */

export interface ChoreItem {
    id: string;
    listId: string;
    text: string;
    isDone: boolean;
}

export interface ChoreList {
    username: string;       // User the list belongs to
    inviteCode: string;     // Ties the list directly to an active chat/conversation
    title: string;
    items: ChoreItem[];
}

/**
 * POST /chores/:inviteCode/:username
 * Adds a new chore list to the specified conversation titled "username's Chores".
 * @param inviteCode The invite code of the conversation.
 * @param username The name of the user the list refers to.
 * @returns void
 */
export function addList(inviteCode: string, username: string): void {
    const token = localStorage.getItem('chat_auth_token');
    const payload = {inviteCode, username};

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

/**
 * POST /chores/:listId/:itemText
 * Adds a new chore item to the specified list.
 * @param listId The ID of the list to which the item belongs.
 * @param itemText The text of the new chore item.
 * @returns void
 */
export function addListItem(listId: string, itemText: string): void {
    const token = localStorage.getItem('chat_auth_token');
    const payload = {text: itemText};

    fetch(`/api/lists/${listId}/items`, {
        method: 'POST',
        headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    })
    .then((response) => {
        if (!response.ok) throw new Error('Failed to add item to list');
        return response.json();
    })
    .then((result) => {
        console.log('Item added successfully:', result.data);
    })
    .catch((error) => console.error('Error adding item:', error));
}

/**
 * UPDATE /chores/:ChoreItem/done
 * Marks a chore item as done in the specified list.
 * @param listId The ID of the list to which the item belongs.
 * @param itemId The ID of the item to update.
 */
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
 
/**
 * UPDATE /chores/:ChoreItem/undone
 * Marks a chore item as not done in the specified list.
 * @param listId The ID of the list to which the item belongs.
 * @param itemId The ID of the item to update.
 */
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

/**
 * DELETE /chores/:ChoreItem
 * Deletes a chore item from the specified list.
 * @param itemId The ID of the item to delete.
 */
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

/**
 * DELETE /chores/:listId
 * Deletes a chore list and all its associated items.
 * @param listId The ID of the list to delete.
 */
export function deleteChoreList(listId: string): void {
    const token = localStorage.getItem('chat_auth_token');
    const activeUserId = localStorage.getItem('chat_user_id') || 'unknown';
  
    fetch(`/api/chores/lists/${listId}`, {
        method: 'DELETE',
        headers: {
        'Authorization': `Bearer ${token}`
        }
    })
    .then((response) => {
        if (!response.ok) {throw new Error(`Failed to delete list. Server returned ${response.status}`);}
        return response.json();
    })
    .then(() => {
        console.log(`Chore list ${listId} successfully purged by user ${activeUserId}.`);
    })
    .catch((error) => {
        console.error(`Deletion pipeline failure for user ${activeUserId}:`, error);
    });
}