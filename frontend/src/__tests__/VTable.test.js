import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import VTable from '@/components/VTable.vue'

describe('VTable', () => {
  const columns = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'role', label: 'Role' }
  ]

  const rows = [
    { name: 'Alice', role: 'admin' },
    { name: 'Bob', role: 'user' }
  ]

  it('renders table with columns', () => {
    const wrapper = mount(VTable, { props: { columns, rows } })
    const ths = wrapper.findAll('thead tr th')
    expect(ths.length).toBe(2)
    expect(ths[0].text()).toContain('Name')
    expect(ths[1].text()).toContain('Role')
  })

  it('renders rows with data', () => {
    const wrapper = mount(VTable, { props: { columns, rows } })
    expect(wrapper.findAll('tbody tr').length).toBe(2)
    const firstRowCells = wrapper.findAll('tbody tr:first-child td')
    expect(firstRowCells[0]?.text()).toBe('Alice')
    const secondRowCells = wrapper.findAll('tbody tr:last-child td')
    expect(secondRowCells[0]?.text()).toBe('Bob')
  })

  it('shows empty state when no data', () => {
    const wrapper = mount(VTable, { props: { columns, rows: [] } })
    expect(wrapper.find('.empty-cell').exists()).toBe(true)
    expect(wrapper.find('.empty-cell').text()).toBe('No data available')
  })

  it('shows custom empty message', () => {
    const wrapper = mount(VTable, { props: { columns, rows: [], emptyMessage: 'Nothing here' } })
    expect(wrapper.find('.empty-cell').text()).toBe('Nothing here')
  })

  it('shows loading skeleton cells', () => {
    const wrapper = mount(VTable, { props: { columns, rows: [], loading: true, skeletonRows: 3 } })
    expect(wrapper.findAll('.skeleton-line').length).toBe(6)
  })

  it('emits sort event when sortable column header is clicked', async () => {
    const wrapper = mount(VTable, { props: { columns, rows } })
    await wrapper.find('th.sortable').trigger('click')
    expect(wrapper.emitted('sort')).toBeTruthy()
    expect(wrapper.emitted('sort')[0][0]).toBe('name')
  })

  it('toggles sort direction on repeated clicks', async () => {
    const wrapper = mount(VTable, { props: { columns, rows } })
    await wrapper.find('th.sortable').trigger('click')
    await wrapper.find('th.sortable').trigger('click')
    expect(wrapper.emitted('sort').length).toBe(2)
  })

  it('applies striped class when striped is true', () => {
    const wrapper = mount(VTable, { props: { columns, rows, striped: true } })
    expect(wrapper.classes()).toContain('v-table--striped')
  })

  it('applies loading class when loading is true', () => {
    const wrapper = mount(VTable, { props: { columns, rows: [], loading: true } })
    expect(wrapper.classes()).toContain('v-table--loading')
  })

  it('renders custom cell slot', () => {
    const slotColumns = [
      { key: 'name', label: 'Name', slot: 'customName' },
      { key: 'role', label: 'Role' }
    ]
    const wrapper = mount(VTable, {
      props: { columns: slotColumns, rows },
      slots: {
        customName: '<span class="custom-cell">Custom</span>'
      }
    })
    expect(wrapper.find('.custom-cell').exists()).toBe(true)
  })

  it('renders actions slot', () => {
    const actionColumns = [...columns, { key: '$actions', label: 'Actions' }]
    const wrapper = mount(VTable, {
      props: { columns: actionColumns, rows },
      slots: {
        actions: '<button class="delete-btn">Delete</button>'
      }
    })
    expect(wrapper.find('.delete-btn').exists()).toBe(true)
  })
})
