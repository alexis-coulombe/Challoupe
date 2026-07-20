import { Button, type ButtonProps } from 'antd';
import { SecurityScanOutlined } from '@ant-design/icons';

// The consistently-styled entry point into the Trivy-powered vulnerability scanner —
// teal instead of the app's blue brand color or the AI violet, so "this button runs a
// security scan" reads at a glance, distinct from every other feature.
export default function SecurityButton({ variant = 'outlined', icon, children, ...rest }: ButtonProps) {
  return (
    <Button color="cyan" variant={variant} icon={icon ?? <SecurityScanOutlined />} {...rest}>
      {children}
    </Button>
  );
}
