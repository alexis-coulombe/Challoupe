import { Button, type ButtonProps } from 'antd';
import { SecurityScanOutlined } from '@ant-design/icons';

// The entry point into the Trivy-powered vulnerability scanner. Teal instead of the
// app's blue brand color or the AI violet, so it reads as "runs a security scan".
export default function SecurityButton({ variant = 'outlined', icon, children, ...rest }: ButtonProps) {
  return (
    <Button color="cyan" variant={variant} icon={icon ?? <SecurityScanOutlined />} {...rest}>
      {children}
    </Button>
  );
}
