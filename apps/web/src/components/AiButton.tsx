import { Button, type ButtonProps } from 'antd';
import { RobotOutlined } from '@ant-design/icons';

// The consistent entry point into every Ollama-powered feature (diagnose, generate, chat).
// Violet instead of the app's blue brand color, so it reads as "talks to the AI assistant".
export default function AiButton({ variant = 'outlined', icon, children, ...rest }: ButtonProps) {
  return (
    <Button color="purple" variant={variant} icon={icon ?? <RobotOutlined />} {...rest}>
      {children}
    </Button>
  );
}
