import { Button, type ButtonProps } from 'antd';
import { RobotOutlined } from '@ant-design/icons';

// The one consistently-styled entry point into every Ollama-powered feature
// (diagnose, generate, chat) — violet instead of the app's blue brand color so
// "this button talks to the AI assistant" reads at a glance, everywhere.
export default function AiButton({ variant = 'outlined', icon, children, ...rest }: ButtonProps) {
  return (
    <Button color="purple" variant={variant} icon={icon ?? <RobotOutlined />} {...rest}>
      {children}
    </Button>
  );
}
