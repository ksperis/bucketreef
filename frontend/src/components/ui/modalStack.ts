const modalStack: string[] = [];
const modalStackListeners = new Set<() => void>();

function notifyModalStackListeners() {
  modalStackListeners.forEach((listener) => listener());
}

export function hasOpenModal() {
  return modalStack.length > 0;
}

export function isTopModal(modalId: string) {
  return modalStack[modalStack.length - 1] === modalId;
}

export function subscribeModalStack(listener: () => void) {
  modalStackListeners.add(listener);
  return () => modalStackListeners.delete(listener);
}

export function registerModal(modalId: string) {
  modalStack.push(modalId);
  notifyModalStackListeners();

  return () => {
    const index = modalStack.indexOf(modalId);
    if (index < 0) return;
    modalStack.splice(index, 1);
    notifyModalStackListeners();
  };
}
