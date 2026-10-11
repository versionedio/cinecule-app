import { Component, ReactNode } from "react";
import { AssistantBubble } from "@/components/chat/Bubbles";

/** If a film's messages fail to draw, say so in the chat instead of leaving the page blank. */
export default class ChatBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    console.error("[chat] a film's messages failed to render", error);
  }

  render() {
    if (this.state.message === null) return this.props.children;
    return (
      <AssistantBubble tone="error">
        <p>I couldn't show this film's messages.</p>
        <p className="mt-1 text-sm opacity-80">{this.state.message}</p>
      </AssistantBubble>
    );
  }
}
