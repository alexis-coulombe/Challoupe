import { Button, Form, Input, Space } from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';

// A repeatable "KEY=value" row — the same shape used for container env vars, container
// labels, and image build arguments.
export default function KeyValueFormList({ name, addLabel }: { name: string; addLabel: string }) {
  return (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <>
          {fields.map((field) => (
            <Space key={field.key} align="baseline" wrap>
              <Form.Item
                name={[field.name, 'value']}
                rules={[{ pattern: /^[^=]+=.*$/, message: 'Format: KEY=value' }]}
              >
                <Input placeholder="KEY=value" style={{ width: 400 }} />
              </Form.Item>
              <MinusCircleOutlined onClick={() => remove(field.name)} />
            </Space>
          ))}
          <Button block icon={<PlusOutlined />} onClick={() => add()}>
            {addLabel}
          </Button>
        </>
      )}
    </Form.List>
  );
}
