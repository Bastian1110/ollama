import { useChats } from "@/hooks/useChats";
import { useRenameChat } from "@/hooks/useRenameChat";
import { useDeleteChat } from "@/hooks/useDeleteChat";
import { useQueryClient } from "@tanstack/react-query";
import { getChat } from "@/api";
import { Link } from "@/components/ui/link";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ChatInfo, ChatsResponse, FolderInfo } from "@/gotypes";
import { AppNavigation } from "@/components/AppSidebar";
import {
  useCreateFolder,
  useDeleteFolder,
  useMoveChatToFolder,
  useRenameFolder,
} from "@/hooks/useFolders";
import { buildChatMenu, groupChatsByFolder } from "@/lib/chatFolders";
import { ChevronRightIcon, PlusIcon } from "@heroicons/react/20/solid";

// there's a hidden debug feature to copy a chat's data to the clipboard by
// holding shift and clicking this many times within this many seconds
const DEBUG_SHIFT_CLICKS_REQUIRED = 5;
const DEBUG_SHIFT_CLICK_WINDOW_MS = 7000; // 7 seconds

const COLLAPSED_FOLDERS_KEY = "ollama.collapsedFolders";

function loadCollapsedFolders(): Set<string> {
  try {
    const stored = JSON.parse(
      localStorage.getItem(COLLAPSED_FOLDERS_KEY) ?? "[]",
    );
    return new Set(Array.isArray(stored) ? stored : []);
  } catch {
    return new Set();
  }
}

function saveCollapsedFolders(collapsed: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify([...collapsed]));
  } catch {
    // collapsed folders are a convenience; losing them is harmless
  }
}

const chatLabel = (chat: ChatInfo) =>
  chat.title || chat.userExcerpt || chat.createdAt.toLocaleString();

interface InlineNameInputProps {
  initialValue?: string;
  placeholder?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

// InlineNameInput edits a name in place. Enter or clicking elsewhere commits,
// Escape or committing a blank value cancels.
function InlineNameInput({
  initialValue = "",
  placeholder,
  onCommit,
  onCancel,
}: InlineNameInputProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  const finish = useCallback(
    (commit: boolean) => {
      if (finished.current) return;
      finished.current = true;
      const trimmed = value.trim();
      if (commit && trimmed) {
        onCommit(trimmed);
      } else {
        onCancel();
      }
    },
    [value, onCommit, onCancel],
  );

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        finish(true);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [finish]);

  return (
    <div className="flex-1 flex items-center min-w-0 px-2 py-2 bg-neutral-100 text-black dark:bg-neutral-800 rounded-lg">
      <span className="truncate font-sans text-sm w-full">
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finish(true);
            } else if (e.key === "Escape") {
              finish(false);
            }
          }}
          className="bg-transparent border-0 focus:outline-none w-full dark:text-white"
          style={{
            font: "inherit",
            lineHeight: "inherit",
            padding: 0,
            margin: 0,
          }}
        />
      </span>
    </div>
  );
}

interface ChatSidebarProps {
  currentChatId?: string;
}

export function ChatSidebar({ currentChatId }: ChatSidebarProps) {
  const { data, isLoading, error } = useChats();
  const queryClient = useQueryClient();
  const renameMutation = useRenameChat();
  const deleteMutation = useDeleteChat();
  const createFolderMutation = useCreateFolder();
  const renameFolderMutation = useRenameFolder();
  const deleteFolderMutation = useDeleteFolder();
  const moveChatMutation = useMoveChatToFolder();
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  // set while naming a new folder; chatId is the chat to move into it, if any
  const [newFolder, setNewFolder] = useState<{ chatId?: string } | null>(null);
  const [collapsedFolders, setCollapsedFolders] =
    useState<Set<string>>(loadCollapsedFolders);
  const [shiftClicks, setShiftClicks] = useState<Record<string, number[]>>({});
  const [copiedChatId, setCopiedChatId] = useState<string | null>(null);

  const handleMouseEnter = useCallback(
    (chatId: string) => {
      queryClient.prefetchQuery({
        queryKey: ["chat", chatId],
        queryFn: () => getChat(chatId),
        staleTime: 1500,
      });
    },
    [queryClient],
  );

  const cancelEditing = useCallback(() => {
    setEditingChatId(null);
    setEditingFolderId(null);
    setNewFolder(null);
  }, []);

  const saveRename = useCallback(
    async (chatId: string, newTitle: string) => {
      // Exit edit mode immediately to prevent flash
      setEditingChatId(null);

      // Optimistically update the cache
      queryClient.setQueryData(
        ["chats"],
        (oldData: ChatsResponse | undefined) => {
          if (!oldData?.chatInfos) return oldData;
          return {
            ...oldData,
            chatInfos: oldData.chatInfos.map((chat) =>
              chat.id === chatId ? { ...chat, title: newTitle } : chat,
            ),
          };
        },
      );

      try {
        await renameMutation.mutateAsync({
          chatId: chatId,
          title: newTitle,
        });
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error: unknown) {
        // Revert optimistic update on error
        queryClient.invalidateQueries({ queryKey: ["chats"] });
      }
    },
    [renameMutation, queryClient],
  );

  const saveFolderRename = useCallback(
    (folderId: string, name: string) => {
      setEditingFolderId(null);
      renameFolderMutation.mutate({ folderId, name });
    },
    [renameFolderMutation],
  );

  const saveNewFolder = useCallback(
    async (name: string) => {
      const chatId = newFolder?.chatId;
      setNewFolder(null);
      try {
        const folder = await createFolderMutation.mutateAsync(name);
        if (chatId) {
          await moveChatMutation.mutateAsync({ chatId, folderId: folder.id });
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error: unknown) {
        // already logged by the mutation
      }
    },
    [newFolder, createFolderMutation, moveChatMutation],
  );

  const toggleFolder = useCallback((folderId: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (!next.delete(folderId)) {
        next.add(folderId);
      }
      saveCollapsedFolders(next);
      return next;
    });
  }, []);

  const sortedChats = useMemo(() => {
    if (!data?.chatInfos) return [];
    return [...data.chatInfos].sort((a, b) => {
      const comparison = b.updatedAt.getTime() - a.updatedAt.getTime();
      if (comparison === 0) {
        return b.id.localeCompare(a.id);
      }
      return comparison;
    });
  }, [data?.chatInfos]);

  const { folderGroups, unfiled } = useMemo(
    () => groupChatsByFolder(sortedChats, data?.folders ?? []),
    [sortedChats, data?.folders],
  );

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const isThisWeek = (date: Date) => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return date > weekAgo && !isToday(date);
  };

  // Group chats by time period
  const groupedChats = useMemo(() => {
    const groups = {
      today: [] as typeof unfiled,
      thisWeek: [] as typeof unfiled,
      older: [] as typeof unfiled,
    };

    unfiled.forEach((chat) => {
      if (isToday(chat.updatedAt)) {
        groups.today.push(chat);
      } else if (isThisWeek(chat.updatedAt)) {
        groups.thisWeek.push(chat);
      } else {
        groups.older.push(chat);
      }
    });

    return groups;
  }, [unfiled]);

  const chatGroups = useMemo(() => {
    return [
      { name: "Today", chats: groupedChats.today },
      { name: "This week", chats: groupedChats.thisWeek },
      { name: "Older", chats: groupedChats.older },
    ].filter((group) => group.chats.length > 0);
  }, [groupedChats]);

  const handleDeleteChat = useCallback(
    async (chatId: string) => {
      const confirmed = window.confirm(
        `Are you sure you want to remove this chat?`,
      );

      if (!confirmed) return;

      try {
        await deleteMutation.mutateAsync(chatId);
      } catch (error) {
        console.error("Failed to delete chat:", error);
      }
    },
    [deleteMutation],
  );

  // implementation of the hidden debug feature to copy a chat's data to the clipboard
  const handleShiftClick = useCallback(
    async (e: React.MouseEvent, chatId: string) => {
      if (!e.shiftKey) return false;

      e.preventDefault();
      const now = Date.now();

      const clicks = shiftClicks[chatId] || [];
      const recentClicks = clicks.filter(
        (timestamp) => now - timestamp < DEBUG_SHIFT_CLICK_WINDOW_MS,
      );
      recentClicks.push(now);

      setShiftClicks((prev) => ({
        ...prev,
        [chatId]: recentClicks,
      }));

      if (recentClicks.length >= DEBUG_SHIFT_CLICKS_REQUIRED) {
        try {
          const chatData = await getChat(chatId);
          const jsonString = JSON.stringify(chatData, null, 2);
          await navigator.clipboard.writeText(jsonString);

          // visual feedback
          setCopiedChatId(chatId);
          setTimeout(() => setCopiedChatId(null), 2000);

          setShiftClicks((prev) => ({
            ...prev,
            [chatId]: [],
          }));
        } catch (error) {
          console.error("Failed to copy chat data:", error);
        }
      }

      return true;
    },
    [shiftClicks],
  );

  const handleContextMenu = useCallback(
    async (chat: ChatInfo) => {
      const { items, actions } = buildChatMenu(
        data?.folders ?? [],
        chat.folderId,
      );
      const selected = await window.menu(items);
      const action = selected ? actions.get(selected) : undefined;

      switch (action?.type) {
        case "rename":
          cancelEditing();
          setEditingChatId(chat.id);
          break;
        case "delete":
          handleDeleteChat(chat.id);
          break;
        case "newFolder":
          cancelEditing();
          setNewFolder({ chatId: chat.id });
          break;
        case "move":
          moveChatMutation.mutate({
            chatId: chat.id,
            folderId: action.folderId,
          });
          break;
      }
    },
    [data?.folders, cancelEditing, handleDeleteChat, moveChatMutation],
  );

  const handleFolderContextMenu = useCallback(
    async (folder: FolderInfo, chatCount: number) => {
      const selected = await window.menu([
        { label: "Rename", enabled: true },
        { label: "Delete", enabled: true },
      ]);

      if (selected === "Rename") {
        cancelEditing();
        setEditingFolderId(folder.id);
      } else if (selected === "Delete") {
        const confirmed = window.confirm(
          chatCount > 0
            ? `Delete the folder "${folder.name}"? Its ${chatCount === 1 ? "chat" : `${chatCount} chats`} will be kept.`
            : `Delete the folder "${folder.name}"?`,
        );
        if (confirmed) {
          deleteFolderMutation.mutate(folder.id);
        }
      }
    },
    [cancelEditing, deleteFolderMutation],
  );

  const renderChat = (chat: ChatInfo) => (
    <div
      key={chat.id}
      className={`allow-context-menu flex items-center relative text-sm text-neutral-800 dark:text-neutral-400 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
        chat.id === currentChatId
          ? "bg-neutral-100 text-black dark:bg-neutral-800"
          : ""
      }`}
      onMouseEnter={() => handleMouseEnter(chat.id)}
      onContextMenu={() => handleContextMenu(chat)}
    >
      {editingChatId === chat.id ? (
        <InlineNameInput
          initialValue={chatLabel(chat)}
          onCommit={(title) => saveRename(chat.id, title)}
          onCancel={cancelEditing}
        />
      ) : (
        <Link
          to="/c/$chatId"
          params={{ chatId: chat.id }}
          className="flex-1 flex items-center min-w-0 px-2 py-2 select-none"
          onClick={(e) => {
            handleShiftClick(e, chat.id);
          }}
          draggable={false}
        >
          <span className="truncate font-sans text-sm">{chatLabel(chat)}</span>
          {copiedChatId === chat.id && (
            <span className="ml-2 text-xs text-green-600 dark:text-green-400">
              Copied!
            </span>
          )}
        </Link>
      )}
    </div>
  );

  const showFolders = folderGroups.length > 0 || newFolder !== null;

  return (
    <nav
      aria-busy={isLoading || undefined}
      className="flex flex-1 flex-col min-h-0 select-none"
    >
      <header className="flex flex-col gap-0.5 px-4 pb-2">
        <AppNavigation current="chat" />
      </header>
      <div className="flex flex-1 flex-col px-4 py-1 overflow-y-auto overscroll-auto scrollbar-gutter">
        {error ? (
          <div className="px-2 pt-4 text-sm text-red-500">
            Error loading chats
          </div>
        ) : (
          <div className="flex flex-col gap-3 pt-4">
            {showFolders && (
              <div className="flex flex-col gap-0.5">
                <div className="group flex items-center justify-between px-2 py-1">
                  <h3 className="text-xs font-medium text-neutral-400 dark:text-neutral-500 select-none">
                    Folders
                  </h3>
                  <button
                    type="button"
                    aria-label="New folder"
                    title="New folder"
                    onClick={() => {
                      cancelEditing();
                      setNewFolder({});
                    }}
                    className="rounded text-neutral-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-neutral-700 dark:hover:text-neutral-200"
                  >
                    <PlusIcon className="h-4 w-4" />
                  </button>
                </div>
                {newFolder && (
                  <div className="flex items-center text-sm">
                    <InlineNameInput
                      placeholder="Folder name"
                      onCommit={saveNewFolder}
                      onCancel={cancelEditing}
                    />
                  </div>
                )}
                {folderGroups.map(({ folder, chats }) => {
                  const collapsed = collapsedFolders.has(folder.id);
                  return (
                    <div key={folder.id} className="flex flex-col gap-0.5">
                      <div
                        className="allow-context-menu flex items-center text-sm text-neutral-800 dark:text-neutral-400 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        onContextMenu={() =>
                          handleFolderContextMenu(folder, chats.length)
                        }
                      >
                        {editingFolderId === folder.id ? (
                          <InlineNameInput
                            initialValue={folder.name}
                            onCommit={(name) =>
                              saveFolderRename(folder.id, name)
                            }
                            onCancel={cancelEditing}
                          />
                        ) : (
                          <button
                            type="button"
                            aria-expanded={!collapsed}
                            onClick={() => toggleFolder(folder.id)}
                            className="flex-1 flex items-center gap-1.5 min-w-0 px-2 py-2 text-left select-none"
                          >
                            <ChevronRightIcon
                              className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${
                                collapsed ? "" : "rotate-90"
                              }`}
                            />
                            <span className="truncate font-sans text-sm">
                              {folder.name}
                            </span>
                            <span className="ml-auto pl-2 text-xs text-neutral-400 dark:text-neutral-500">
                              {chats.length}
                            </span>
                          </button>
                        )}
                      </div>
                      {!collapsed && chats.length > 0 && (
                        <div className="flex flex-col gap-0.5 pl-4">
                          {chats.map(renderChat)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {chatGroups.map((group) => (
              <div key={group.name} className="flex flex-col gap-0.5">
                <h3 className="text-xs font-medium text-neutral-400 dark:text-neutral-500 px-2 py-1 select-none">
                  {group.name}
                </h3>
                {group.chats.map(renderChat)}
              </div>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
