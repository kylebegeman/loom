import Constants from "expo-constants"; // fork: mobile-identity
import AgentActivity, { type AgentActivityProps } from "../../widgets/AgentActivity";

export function dismissEndedAgentLiveActivities() {
  AgentActivity.dismissEnded();
}

export function getAgentLiveActivities() {
  return AgentActivity.getInstances();
}

export function startAgentLiveActivity(props: AgentActivityProps, staleDate?: Date) {
  const configuredScheme = Constants.expoConfig?.scheme;
  const appScheme = Array.isArray(configuredScheme) ? configuredScheme[0] : configuredScheme;
  return AgentActivity.start({ ...props, appScheme: appScheme ?? "loom" }, undefined, staleDate);
}
