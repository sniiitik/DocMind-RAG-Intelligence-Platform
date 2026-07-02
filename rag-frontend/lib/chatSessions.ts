export type StoredChatSession = {
    id: string
    title: string
    sessionId: string
    messages: unknown[]
    createdAt: string
    updatedAt: string
}

export const CHAT_STORAGE_KEY = 'docmind_chat_sessions'
export const ACTIVE_CHAT_KEY = 'docmind_active_chat_id'
export const CHAT_UPDATED_EVENT = 'docmind-chat-updated'
export const CHAT_SELECTED_EVENT = 'docmind-chat-selected'
export const CHAT_NEW_EVENT = 'docmind-chat-new'
export const CHAT_DELETE_EVENT = 'docmind-chat-delete'
export const CHAT_NEW_REQUEST_KEY = 'docmind_chat_new_request'

function isStoredChatEmpty(chat: StoredChatSession) {
    return !chat.messages || chat.messages.length === 0
}

export function loadStoredChats(): StoredChatSession[] {
    if (typeof window === 'undefined') return []

    try {
        const raw = window.localStorage.getItem(CHAT_STORAGE_KEY)
        if (!raw) return []
        return JSON.parse(raw) as StoredChatSession[]
    } catch {
        return []
    }
}

export function saveStoredChats(chats: StoredChatSession[]) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chats))
    window.dispatchEvent(new CustomEvent(CHAT_UPDATED_EVENT))
}

export function setActiveStoredChat(chatId: string) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(ACTIVE_CHAT_KEY, chatId)
    window.dispatchEvent(new CustomEvent(CHAT_SELECTED_EVENT, { detail: { chatId } }))
}

export function getActiveStoredChatId() {
    if (typeof window === 'undefined') return ''
    return window.localStorage.getItem(ACTIVE_CHAT_KEY) || ''
}

export function requestNewStoredChat() {
    if (typeof window === 'undefined') return

    const chats = loadStoredChats()
    const activeChatId = getActiveStoredChatId()
    const activeChat = chats.find(chat => chat.id === activeChatId)

    if (activeChat && isStoredChatEmpty(activeChat)) {
        setActiveStoredChat(activeChat.id)
        return
    }

    const existingEmptyChat = chats.find(isStoredChatEmpty)
    if (existingEmptyChat) {
        setActiveStoredChat(existingEmptyChat.id)
        return
    }

    window.localStorage.setItem(CHAT_NEW_REQUEST_KEY, String(Date.now()))
    window.dispatchEvent(new CustomEvent(CHAT_NEW_EVENT))
}

export function consumeNewStoredChatRequest() {
    if (typeof window === 'undefined') return false
    const value = window.localStorage.getItem(CHAT_NEW_REQUEST_KEY)
    if (!value) return false
    window.localStorage.removeItem(CHAT_NEW_REQUEST_KEY)
    return true
}

export function requestDeleteStoredChat(chatId: string) {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(CHAT_DELETE_EVENT, { detail: { chatId } }))
}
