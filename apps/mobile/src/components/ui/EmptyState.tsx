import { View } from "react-native";
import type { ReactNode } from "react";

import { AppText as Text } from "./AppText";
import { Button } from "./Button";

export function EmptyState(props: {
  readonly title: string;
  readonly detail: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly action?: ReactNode;
  readonly variant?: "card" | "plain";
}) {
  if (props.variant === "plain") {
    return (
      <View className="items-center px-6 py-10">
        <Text textRole="title" className="text-center font-t3-bold text-foreground">
          {props.title}
        </Text>
        <Text
          textRole="body"
          className="mt-3 max-w-[340px] text-center font-sans text-foreground-muted"
        >
          {props.detail}
        </Text>
        {props.action ? (
          <View className="mt-5">{props.action}</View>
        ) : props.actionLabel && props.onAction ? (
          <View className="mt-5">
            <Button tone="primary" label={props.actionLabel} onPress={props.onAction} />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View className="gap-1 px-1 py-5">
      <Text textRole="headline" className="font-t3-bold text-foreground">
        {props.title}
      </Text>
      <Text textRole="footnote" className="mt-2 font-sans leading-relaxed text-foreground-muted">
        {props.detail}
      </Text>
      {props.action ? (
        <View className="mt-4 self-start">{props.action}</View>
      ) : props.actionLabel && props.onAction ? (
        <View className="mt-4 self-start">
          <Button tone="primary" label={props.actionLabel} onPress={props.onAction} />
        </View>
      ) : null}
    </View>
  );
}
