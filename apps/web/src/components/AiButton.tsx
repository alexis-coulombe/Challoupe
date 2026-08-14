import { Button, type ButtonProps } from 'antd';
import { RobotOutlined } from '@ant-design/icons';

// The consistent entry point into every Ollama-powered feature (diagnose, generate, chat).
// Solid violet, not the app's red, so it reads as "talks to the AI assistant" and stands
// out from every other (outlined/default) button around it rather than blending in.
export default function AiButton({ variant = 'solid', icon, children, ...rest }: ButtonProps) {
  return (
    <Button color="purple" variant={variant} icon={icon ?? <RobotOutlined />} {...rest}>
      {children}
    </Button>
  );
}
