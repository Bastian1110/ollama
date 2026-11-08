import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createFolder,
  deleteFolder,
  moveChatToFolder,
  renameFolder,
} from "@/api";

// Folders are returned with the chat list, so every change refreshes ["chats"].
function useChatsMutation<TVars, TResult>(
  mutationFn: (vars: TVars) => Promise<TResult>,
  description: string,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["chats"] });
    },
    onError: (error) => {
      console.error(`Failed to ${description}:`, error);
    },
  });
}

export function useCreateFolder() {
  return useChatsMutation(
    (name: string) => createFolder(name),
    "create folder",
  );
}

export function useRenameFolder() {
  return useChatsMutation(
    ({ folderId, name }: { folderId: string; name: string }) =>
      renameFolder(folderId, name),
    "rename folder",
  );
}

export function useDeleteFolder() {
  return useChatsMutation(
    (folderId: string) => deleteFolder(folderId),
    "delete folder",
  );
}

export function useMoveChatToFolder() {
  return useChatsMutation(
    ({ chatId, folderId }: { chatId: string; folderId: string }) =>
      moveChatToFolder(chatId, folderId),
    "move chat",
  );
}
