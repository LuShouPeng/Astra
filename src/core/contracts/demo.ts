export type DemoSpeed = 0.5 | 1 | 2;

export interface DemoRuntimeState {
  isRunning: boolean;
  speed: DemoSpeed;
  currentStep: number;
}
