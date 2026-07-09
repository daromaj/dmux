interface QmuxProcessShutdownState {
  claimed: boolean;
  owner?: string;
}

type GlobalWithQmuxShutdownState = typeof globalThis & {
  __qmuxProcessShutdownState?: QmuxProcessShutdownState;
};

function getShutdownState(): QmuxProcessShutdownState {
  const globalWithState = globalThis as GlobalWithQmuxShutdownState;
  if (!globalWithState.__qmuxProcessShutdownState) {
    globalWithState.__qmuxProcessShutdownState = {
      claimed: false,
    };
  }

  return globalWithState.__qmuxProcessShutdownState;
}

export function claimProcessShutdown(owner: string): boolean {
  const state = getShutdownState();
  if (state.claimed) {
    return false;
  }

  state.claimed = true;
  state.owner = owner;
  return true;
}

export function getClaimedProcessShutdownOwner(): string | undefined {
  return getShutdownState().owner;
}

export function resetProcessShutdownForTesting(): void {
  const state = getShutdownState();
  state.claimed = false;
  state.owner = undefined;
}
