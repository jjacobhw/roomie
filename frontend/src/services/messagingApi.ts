// The only messaging module the screens and hooks should import from.
// It picks the real backend when EXPO_PUBLIC_API_URL is set (see config.ts) and
// falls back to the in-memory mock otherwise.
import { USING_MOCK } from '../config';
import * as http from './httpApi';
import * as mock from './mockApi';

// Both implementations must have the same functions; this line makes TypeScript check it.
const api: typeof mock = USING_MOCK ? mock : http;

export const signUp = api.signUp;
export const signIn = api.signIn;
export const signOut = api.signOut;
export const getMyConversation = api.getMyConversation;
export const createConversation = api.createConversation;
export const joinConversation = api.joinConversation;
export const getMessages = api.getMessages;
export const sendMessage = api.sendMessage;
export const uploadAttachment = api.uploadAttachment;
export const getChoreLists = api.getChoreLists;
export const createChoreList = api.createChoreList;
export const deleteChoreList = api.deleteChoreList;
export const createChoreItem = api.createChoreItem;
export const setChoreItemDone = api.setChoreItemDone;
export const deleteChoreItem = api.deleteChoreItem;
export const getMembers = api.getMembers;
export const renameConversation = api.renameConversation;
export const leaveConversation = api.leaveConversation;
