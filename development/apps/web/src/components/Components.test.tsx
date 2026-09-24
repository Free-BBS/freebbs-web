import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DialogForm } from './DialogForm.js';
import { AsyncState } from './AsyncState.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { DetailSection } from './DetailSection.js';
import { EditorDrawer } from './EditorDrawer.js';
import { EmptyState } from './EmptyState.js';
import { FilterBar } from './FilterBar.js';
import { ModulePageHeader } from './ModulePageHeader.js';
import { PermissionActions } from './PermissionActions.js';
import { RecordList } from './RecordList.js';
import { ResponsiveRecordList } from './ResponsiveRecordList.js';
import { StatusBadge } from './StatusBadge.js';

describe('shared module presentation primitives', () => {
  it('renders a level-two module heading with an optional English kicker and actions', () => {
    render(
      <ModulePageHeader
        kicker="KNOWLEDGE BASE"
        title="经验库"
        description="把经验写清楚，也让后来者找得到。"
        actions={<button type="button">新建条目</button>}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: '经验库' })).toBeInTheDocument();
    expect(screen.getByText('KNOWLEDGE BASE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建条目' })).toBeInTheDocument();
  });

  it('keeps filter controls inside a named form with their accessible labels', () => {
    render(
      <FilterBar ariaLabel="经验筛选">
        <label>
          关键词
          <input name="query" />
        </label>
        <button type="submit">筛选</button>
      </FilterBar>,
    );

    expect(screen.getByRole('search', { name: '经验筛选' })).toContainElement(
      screen.getByLabelText('关键词'),
    );
  });

  it('renders loading, empty and error async states with appropriate semantics', () => {
    const { rerender } = render(<AsyncState state="loading" loadingLabel="正在加载经验" />);
    expect(screen.getByRole('status')).toHaveTextContent('正在加载经验');

    rerender(<AsyncState state="empty" title="暂无经验" description="创建第一条经验。" />);
    expect(screen.getByText('暂无经验').closest('[data-state]')).toHaveAttribute(
      'data-state',
      'empty',
    );

    rerender(<AsyncState state="error" title="加载失败" description="请稍后重试。" />);
    expect(screen.getByRole('alert')).toHaveTextContent('加载失败');
  });

  it('renders responsive records as a named list and owns its async states', () => {
    const records = [{ id: 'entry-1', title: '第一条经验' }];
    const props = {
      ariaLabel: '经验条目',
      records,
      emptyTitle: '暂无经验',
      getKey: (record: (typeof records)[number]) => record.id,
      renderRecord: (record: (typeof records)[number]) => <article>{record.title}</article>,
    };
    const { rerender } = render(<ResponsiveRecordList {...props} state="ready" />);

    expect(screen.getByRole('list', { name: '经验条目' })).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('第一条经验');

    rerender(<ResponsiveRecordList {...props} records={[]} state="loading" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '经验条目' })).not.toBeInTheDocument();

    rerender(<ResponsiveRecordList {...props} records={[]} state="ready" />);
    expect(screen.getByText('暂无经验').closest('[data-state]')).toHaveAttribute(
      'data-state',
      'empty',
    );
    expect(screen.queryByRole('list', { name: '经验条目' })).not.toBeInTheDocument();

    rerender(
      <ResponsiveRecordList {...props} records={[]} state="error" errorMessage="加载失败" />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('加载失败');
    expect(screen.queryByRole('list', { name: '经验条目' })).not.toBeInTheDocument();
  });

  it('traps focus and restores body scrolling for drawers and confirmation dialogs', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [editorOpen, setEditorOpen] = useState(false);
      const [confirmOpen, setConfirmOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setEditorOpen(true)}>
            打开编辑器
          </button>
          <button type="button" onClick={() => setConfirmOpen(true)}>
            打开确认框
          </button>
          <EditorDrawer open={editorOpen} title="编辑条目" onClose={() => setEditorOpen(false)}>
            <label>
              标题
              <input />
            </label>
          </EditorDrawer>
          <ConfirmDialog
            open={confirmOpen}
            title="确认删除"
            onClose={() => setConfirmOpen(false)}
            onConfirm={() => setConfirmOpen(false)}
          />
        </>
      );
    }

    document.body.style.overflow = 'clip';
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: '打开编辑器' }));
    const closeEditor = screen.getByRole('button', { name: '关闭编辑器' });
    const title = screen.getByLabelText('标题');
    expect(document.body).toHaveStyle({ overflow: 'hidden' });
    expect(closeEditor).toHaveFocus();
    await user.tab();
    expect(title).toHaveFocus();
    await user.tab();
    expect(closeEditor).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(document.body).toHaveStyle({ overflow: 'clip' });

    await user.click(screen.getByRole('button', { name: '打开确认框' }));
    const cancel = screen.getByRole('button', { name: '取消' });
    const confirm = screen.getByRole('button', { name: '确认' });
    expect(document.body).toHaveStyle({ overflow: 'hidden' });
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(document.body).toHaveStyle({ overflow: 'clip' });
    document.body.style.overflow = '';
  });

  it('labels editor drawers and confirmation dialogs and restores focus when they close', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [editorOpen, setEditorOpen] = useState(false);
      const [confirmOpen, setConfirmOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setEditorOpen(true)}>
            编辑经验
          </button>
          <button type="button" onClick={() => setConfirmOpen(true)}>
            删除经验
          </button>
          <EditorDrawer
            open={editorOpen}
            title="编辑经验"
            description="更新后会立即发布。"
            onClose={() => setEditorOpen(false)}
          >
            <label>
              标题
              <input />
            </label>
          </EditorDrawer>
          <ConfirmDialog
            open={confirmOpen}
            title="删除经验"
            description="删除后不可恢复。"
            onClose={() => setConfirmOpen(false)}
            onConfirm={() => setConfirmOpen(false)}
          />
        </>
      );
    }

    render(<Harness />);
    const editorTrigger = screen.getByRole('button', { name: '编辑经验' });
    await user.click(editorTrigger);
    expect(screen.getByRole('dialog', { name: '编辑经验' })).toHaveAttribute('aria-modal', 'true');
    await user.keyboard('{Escape}');
    expect(editorTrigger).toHaveFocus();

    const confirmTrigger = screen.getByRole('button', { name: '删除经验' });
    await user.click(confirmTrigger);
    expect(screen.getByRole('alertdialog', { name: '删除经验' })).toHaveTextContent(
      '删除后不可恢复。',
    );
    await user.keyboard('{Escape}');
    expect(confirmTrigger).toHaveFocus();
  });

  it('hides restricted actions and structures details below the module heading level', () => {
    render(
      <>
        <PermissionActions allowed={false}>
          <button type="button">删除</button>
        </PermissionActions>
        <DetailSection title="条目详情" description="最新更新时间">
          <p>正文</p>
        </DetailSection>
      </>,
    );

    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '条目详情' })).toBeInTheDocument();
    expect(screen.getByText('正文')).toBeInTheDocument();
  });
});

describe('RecordList', () => {
  const records = [
    { id: 'first', name: '第一条' },
    { id: 'second', name: '第二条' },
  ];

  it('renders successful records as a named list', () => {
    render(
      <RecordList
        ariaLabel="经验条目"
        items={records}
        getKey={(record) => record.id}
        renderItem={(record) => <span>{record.name}</span>}
      />,
    );

    expect(screen.getByRole('list', { name: '经验条目' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('distinguishes loading, empty and error states from successful content', () => {
    const props = {
      ariaLabel: '经验条目',
      items: records,
      getKey: (record: (typeof records)[number]) => record.id,
      renderItem: (record: (typeof records)[number]) => <span>{record.name}</span>,
    };
    const { rerender } = render(<RecordList {...props} isLoading loadingLabel="正在加载" />);

    expect(screen.getByText('正在加载')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();

    rerender(<RecordList {...props} items={[]} emptyTitle="暂无条目" />);
    expect(screen.getByText('暂无条目').closest('[data-state]')).toHaveAttribute(
      'data-state',
      'empty',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    rerender(<RecordList {...props} error="加载失败" />);
    expect(screen.getByRole('alert')).toHaveTextContent('加载失败');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('StatusBadge', () => {
  it('exposes its visual status without announcing a false success state', () => {
    render(<StatusBadge status="warning">待审核</StatusBadge>);

    const badge = screen.getByText('待审核');
    expect(badge).toHaveClass('status-badge');
    expect(badge).toHaveAttribute('data-status', 'warning');
    expect(badge).toHaveAttribute('data-tone', 'warning');
    expect(badge).not.toHaveAttribute('role', 'status');
  });
});

describe('EmptyState', () => {
  it('uses alert semantics only for errors', () => {
    const { rerender } = render(<EmptyState title="暂无数据" description="可以稍后创建" />);

    expect(screen.getByText('暂无数据').closest('[data-state]')).toHaveAttribute(
      'data-state',
      'empty',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    rerender(<EmptyState variant="error" title="请求失败" description="请重试" />);
    expect(screen.getByRole('alert')).toHaveTextContent('请求失败');
  });
});

describe('DialogForm', () => {
  function Harness({ onSubmit = vi.fn() }: { onSubmit?: () => void | Promise<void> }) {
    const [open, setOpen] = useState(false);

    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          新建条目
        </button>
        <DialogForm
          open={open}
          title="新建经验"
          description="请填写条目信息"
          submitLabel="保存"
          onClose={() => setOpen(false)}
          onSubmit={onSubmit}
        >
          <label htmlFor="record-title">标题</label>
          <input id="record-title" />
          <label htmlFor="record-body">内容</label>
          <textarea id="record-body" />
        </DialogForm>
      </>
    );
  }

  it('renders a labelled modal and focuses its first field', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: '新建条目' }));

    const dialog = screen.getByRole('dialog', { name: '新建经验' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('标题')).toHaveFocus();
  });

  it('keeps a bounded scroll body and reachable footer while open', () => {
    document.body.style.overflow = 'clip';
    const { rerender } = render(
      <DialogForm open title="新建经验" onClose={vi.fn()} onSubmit={vi.fn()}>
        <label htmlFor="bounded-title">标题</label>
        <input id="bounded-title" />
      </DialogForm>,
    );

    const dialog = screen.getByRole('dialog', { name: '新建经验' });
    const body = dialog.querySelector('.dialog-form-body');
    const actions = dialog.querySelector('.dialog-form-actions');
    expect(document.body).toHaveStyle({ overflow: 'hidden' });
    expect(body).toContainElement(screen.getByLabelText('标题'));
    expect(actions?.parentElement).toHaveClass('dialog-form-layout');
    expect(body?.nextElementSibling).toBe(actions);

    rerender(
      <DialogForm open={false} title="新建经验" onClose={vi.fn()} onSubmit={vi.fn()}>
        <span>内容</span>
      </DialogForm>,
    );
    expect(document.body).toHaveStyle({ overflow: 'clip' });
    document.body.style.overflow = '';
  });

  it('traps forward and backward focus inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '新建条目' }));

    const firstField = screen.getByLabelText('标题');
    const submit = screen.getByRole('button', { name: '保存' });

    submit.focus();
    await user.tab();
    expect(firstField).toHaveFocus();

    firstField.focus();
    await user.tab({ shift: true });
    expect(submit).toHaveFocus();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '新建条目' });
    await user.click(trigger);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('submits once and exposes pending, error and feedback states', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <DialogForm open title="新建经验" onClose={vi.fn()} onSubmit={onSubmit}>
        <label htmlFor="title">标题</label>
        <input id="title" />
      </DialogForm>,
    );

    await user.click(screen.getByRole('button', { name: '提交' }));
    expect(onSubmit).toHaveBeenCalledOnce();

    rerender(
      <DialogForm
        open
        title="新建经验"
        pending
        error="保存失败"
        feedback="草稿已保存"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      >
        <label htmlFor="title">标题</label>
        <input id="title" />
      </DialogForm>,
    );

    expect(screen.getByRole('button', { name: '正在提交…' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
    expect(screen.getByRole('status')).toHaveTextContent('草稿已保存');
  });
});
