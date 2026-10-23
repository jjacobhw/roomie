/*
 * Roomie Texting Module
 * Provides functions to manage user accounts, conversations, and messages in PostgreSQL.
 * All error messages are logged to the console.
 */

type QueryRow = any;

// instantiating query row as an array of texts
type QueryResult<T = QueryRow> = {
    rows: T[];
};

interface PgClient {
    query: <T = QueryRow>(text: string, values?: unknown[]) => Promise<QueryResult<T>>;
}

declare const pgClient: PgClient;

export interface User {
    name: string;           // The username of the user
    password: string;       // The password of the user
    avatarUrl: string;      // The URL of the user's avatar image
}

export interface Message {
    username: string;       // The username of the sender
    messageText: string;    // The contents of the message
    attachments: unknown;   // The attachments of the message
    timestamp: Date;        // The timestamp of the message
}

export interface Conversation {
    inviteCode: string;     // The invite code for the conversation
    messages: Message[];    // The messages in the conversation
    users: string[];        // The usernames of the users in the conversation
}

export interface ConversationSummary {
    inviteCode: string;
    name: string;
    users: string[];
}

export async function getConversations(pgClient: PgClient): Promise<ConversationSummary[]> {
    const result = await pgClient.query<ConversationSummary>(
        `SELECT h.invite_code AS "inviteCode",
                h.name,
                COALESCE(
                    array_agg(u.display_name ORDER BY u.display_name)
                        FILTER (WHERE u.id IS NOT NULL),
                    ARRAY[]::text[]
                ) AS users
         FROM households h
         LEFT JOIN household_members hm ON hm.household_id = h.id
         LEFT JOIN users u ON u.id = hm.user_id
         GROUP BY h.id
         ORDER BY h.created_at DESC`
    );

    return result.rows;
}

export async function getMessages(
    pgClient: PgClient,
    inviteCode: string
): Promise<Message[] | null> {
    const conversationResult = await pgClient.query(
        'SELECT id FROM households WHERE invite_code = $1',
        [inviteCode]
    );
    if (conversationResult.rows.length === 0) {
        return null;
    }

    const result = await pgClient.query<Message>(
        `SELECT u.display_name AS username,
                p.body AS "messageText",
                ARRAY[]::text[] AS attachments,
                p.created_at AS timestamp
         FROM posts p
         JOIN households h ON h.id = p.household_id
         JOIN users u ON u.id = p.author_id
         WHERE h.invite_code = $1
         ORDER BY p.created_at ASC`,
        [inviteCode]
    );

    return result.rows;
}

/**
 * Creates a user account with a username and password, adds them to PostgreSQL,
 * and returns the user object.
 */
export function createAccount(username: string, password: string): User {
    // Check if the username already exists in PostgreSQL
    void pgClient.query('SELECT * FROM users WHERE name = $1', [username]).then((result) => {
        if (result.rows.length > 0) {
            console.error(`Username ${username} already exists.`);
            return result.rows[0] as User;
        }
        return undefined;
    });

    // Initialize the user object with the provided username and password, and a default avatar URL
    const user: User = {
        name: username,
        password: password,
        avatarUrl: 'https://kommodo.ai/i/zxasnXB2wNYSXfxpIr9N',
    };

    // Add the new user into the PostgreSQL database
    void pgClient.query('INSERT INTO users (name, password, avatarUrl) VALUES ($1, $2, $3)', [
        username,
        password,
        'https://kommodo.ai/i/zxasnXB2wNYSXfxpIr9N',
    ]);

    return user;
}

/**
 * Update the user's username in PostgreSQL.
 */
export function updateProfileUsername(oldUsername: string, newUsername: string): boolean {
    // Check if the old username exists in PostgreSQL
    void pgClient.query('SELECT * FROM users WHERE name = $1', [oldUsername]).then((result) => {
        if (result.rows.length === 0) {
            console.error(`User ${oldUsername} not found.`);
            return false;
        }

        // If old username exists, update it to the new username
        void pgClient.query('UPDATE users SET name = $1 WHERE name = $2', [newUsername, oldUsername]);
        return true;
    });

    return true;
}

/**
 * Update the user's profile picture (avatar URL) in PostgreSQL.
 */
export function updateProfilePic(username: string, avatarUrl: string): boolean {
    // Check if the user exists in PostgreSQL
    void pgClient.query('SELECT * FROM users WHERE name = $1', [username]).then((result) => {
        if (result.rows.length === 0) {
            console.error(`User ${username} not found.`);
            return false;
        }

        // If the user exists, update their avatar URL
        void pgClient.query('UPDATE users SET avatarUrl = $1 WHERE name = $2', [avatarUrl, username]);
        return true;
    });

    return true;
}

/**
 * Delete the user's account from PostgreSQL.
 */
export function deleteAccount(username: string): boolean {
    // Check if the user exists in PostgreSQL
    void pgClient.query('SELECT * FROM users WHERE name = $1', [username]).then((result) => {
        if (result.rows.length === 0) {
            console.error(`User ${username} not found.`);
            return false;
        }

        // If the user exists, delete their account
        void pgClient.query('DELETE FROM users WHERE name = $1', [username]);

        // Verify that the user has been deleted
        void pgClient.query('SELECT * FROM users WHERE name = $1', [username]).then((deletedResult) => {
            if (deletedResult.rows.length !== 0) {
                console.error(`Failed to delete user ${username}.`);
                return false;
            }
            return true;
        });
        return true;
    });

    return true;
}

/**
 * Initialize a chat room in PostgreSQL associated with the given username
 * and return an invite code to it.
 */
export async function createConversation(username: string): Promise<string> {
    // Check if username exists in PostgreSQL
    const userResult = await pgClient.query('SELECT * FROM users WHERE name = $1', [username]);
    if (userResult.rows.length === 0) {
        console.error(`User ${username} not found.`);
        return '-1';
    }

    // Check if the user is already in a conversation
    const userConversationsResult = await pgClient.query('SELECT * FROM conversations WHERE $1 = ANY(users)', [username]);
    if (userConversationsResult.rows.length !== 0) {
        const conversation = userConversationsResult.rows[0] as Conversation;
        console.error(`User ${username} is already in a conversation with invite code ${conversation.inviteCode}.`);
        return '-1';
    }

    let inviteCode: string;
    let existingResult: QueryResult;

    // Generate a unique 6 digit invite code for the conversation
    do {
        inviteCode = Math.random().toString(36).substring(2, 8);
        existingResult = await pgClient.query('SELECT * FROM conversations WHERE inviteCode = $1', [inviteCode]);
    } while (existingResult.rows.length !== 0);

    const conversation: Conversation = {
        inviteCode,
        messages: [],
        users: [username],
    };

    await pgClient.query('INSERT INTO conversations (inviteCode, messages, users) VALUES ($1, $2, $3)', [
        conversation.inviteCode,
        JSON.stringify(conversation.messages),
        conversation.users,
    ]);

    return inviteCode;
}

/**
 * Add user to the conversation in PostgreSQL associated with the given invite code.
 */
export async function joinConversation(username: string, inviteCode: string): Promise<boolean> {
    // Check if username exists in PostgreSQL
    const userResult = await pgClient.query('SELECT * FROM users WHERE name = $1', [username]);
    if (userResult.rows.length === 0) {
        console.error(`User ${username} not found.`);
        return false;
    }

    // Check if the user is already in a conversation
    const userConversationsResult = await pgClient.query('SELECT * FROM conversations WHERE $1 = ANY(users)', [username]);
    if (userConversationsResult.rows.length !== 0) {
        const conversation = userConversationsResult.rows[0] as Conversation;
        console.error(`User ${username} is already in a conversation with invite code ${conversation.inviteCode}.`);
        return false;
    }

    // Check if the conversation with the given invite code exists
    const conversationResult = await pgClient.query('SELECT * FROM conversations WHERE inviteCode = $1', [inviteCode]);
    if (conversationResult.rows.length === 0) {
        console.error(`Conversation with invite code ${inviteCode} does not exist.`);
        return false;
    }

    // Add the user to the conversation's users array in PostgreSQL
    await pgClient.query('UPDATE conversations SET users = array_append(users, $1) WHERE inviteCode = $2', [username, inviteCode]);
    return true;
}

/**
 * Refresh messages in conversation to the user's screen.
 */
export async function getConversation(inviteCode: string): Promise<boolean> {
    const conversationRef = pgClient.query('SELECT * FROM conversations WHERE inviteCode = $1', [inviteCode]);
    const displayedMessages = new Set<string>();
    const conversationResult = await conversationRef;

    // Check if conversation with the given invite code exists
    if (conversationResult.rows.length === 0) {
        console.error(`Conversation with invite code ${inviteCode} does not exist.`);
        return false;
    }
    
    // Display messages in the conversation that have not been displayed yet
    if (conversationResult.rows.length !== 0) {
        const conversation = conversationResult.rows[0] as Conversation;
        conversation.messages.forEach((message: Message) => {
            if (!displayedMessages.has(message.messageText)) {
                console.log(message);
                displayedMessages.add(message.messageText);
            }
        });
    }

    return true;
}

/**
 * Remove a user from the conversation in PostgreSQL associated with the given invite code.
 */
export async function leaveConversation(username: string, inviteCode: string): Promise<boolean> {
    // Check if the conversation with the given invite code exists in PostgreSQL
    const conversationResult = await pgClient.query('SELECT * FROM conversations WHERE inviteCode = $1', [inviteCode]);
    if (conversationResult.rows.length === 0) {
        console.error(`Conversation with invite code ${inviteCode} does not exist.`);
        return false;
    }

    // Remove the user from the conversation's users array in PostgreSQL
    const conversation = conversationResult.rows[0] as Conversation;
    await pgClient.query('UPDATE conversations SET users = array_remove(users, $1) WHERE inviteCode = $2', [username, inviteCode]);

    // If the conversation has no users left, delete it from PostgreSQL
    if (conversation.users.length === 0) {
        await deleteConversation(inviteCode);
    }

    // Verify that the user has been removed from the conversation
    const updatedConversationResult = await pgClient.query('SELECT * FROM conversations WHERE inviteCode = $1', [inviteCode]);
    if (updatedConversationResult.rows.length !== 0) {
        const updatedConversation = updatedConversationResult.rows[0] as Conversation;
        if (updatedConversation.users.includes(username)) {
            return false;
        }
    }

    return true;
}

/**
 * Delete a conversation from PostgreSQL associated with the given invite code.
 */
export async function deleteConversation(inviteCode: string): Promise<boolean> {
    // Check if the conversation with the given invite code exists in PostgreSQL
    const conversationResult = await pgClient.query('SELECT * FROM conversations WHERE inviteCode = $1', [inviteCode]);
    if (conversationResult.rows.length === 0) {
        console.error(`Conversation with invite code ${inviteCode} does not exist.`);
        return false;
    }

    // Remove the conversation from PostgreSQL
    await pgClient.query('DELETE FROM conversations WHERE inviteCode = $1', [inviteCode]);
    
    // Check if the conversation has been successfully deleted
    const updatedConversationResult = await pgClient.query('SELECT * FROM conversations WHERE inviteCode = $1', [inviteCode]);
    if (updatedConversationResult.rows.length !== 0) {
        console.error('Failed to delete conversation with invite code:', inviteCode);
        return false;
    }

    return true;
}

/**
 * Add a message to the front of the queue in the specified conversation.
 */
export async function sendMessage(username: string, inviteCode: string, messageText: string, attachments: unknown = []): Promise<boolean> {
    // Check if the conversation with the given invite code exists in PostgreSQL
    const conversationResult = await pgClient.query('SELECT * FROM conversations WHERE inviteCode = $1', [inviteCode]);
    if (conversationResult.rows.length === 0) {
        console.error('Conversation with invite code not found:', inviteCode);
        return false;
    }
    
    // Add the message to the front of the messages array in PostgreSQL
    await pgClient.query('UPDATE conversations SET messages = array_prepend($1, messages) WHERE inviteCode = $2', [{
        username,
        messageText,
        attachments,
        timestamp: new Date(),
    }, inviteCode]);

    // Verify that the message has been successfully added to the conversation
    const conversation = conversationResult.rows[0] as Conversation;
    const messageExists = conversation.messages.some((message: Message) => {
        return message.messageText === messageText && message.username === username;
    });
    if (!messageExists) {
        console.error('Failed to send message to conversation with invite code:', inviteCode);
        return false;
    }

    return true;
}

/**
 * Upload a media file to the server.
 */
export function uploadMedia(file: File): void{
    const token = localStorage.getItem('chat_auth_token');
    const activeUserId = localStorage.getItem('chat_user_id') || 'unknown';

    const formdata = new FormData();
    formdata.append('mediafile', file);

    fetch('/api/chat/upload', {
        method: 'POST',
        headers: {'Authorization': `Bearer ${token}`},
        body: formdata,
    })
    .then((response) => {
        if (!response.ok) {
            throw new Error(`Upload failed. Status: ${response.status}`);
        }
        return response.json();
    })
    .then((result) => {
        console.log('Media uploaded successfully:', result.data);
        
        // do we use socket.io? if so, we need this:
        // socket.emit('sendMessage', result.data);
    })
    .catch((error) => {
        console.error('Error handling media upload:', error);
    });
}

export function signInUser(username: string, password: string): void {
    const userinfo_dict = {username, password};
    let attemptedUserID: string = 'nan';
    fetch('/api/auth/signin', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(userinfo_dict),
    })
        .then((response) => {
            if (!response.ok){
                throw new Error('Invalid login or server error');
            }
            return response.json();
        })
        .then((result) => {
            attemptedUserID = result.user.id;
            localStorage.setItem('chat_auth_token', result.token);
            console.log(`User ${attemptedUserID} signed in`);
        })
        .catch((error) => {
            console.error('Sign-in failed for user ', attemptedUserID);
            // also need to display error message for user in UI
        });
}

// TODO: Implement this later if there is time
// export function signOutUser(): void {}
