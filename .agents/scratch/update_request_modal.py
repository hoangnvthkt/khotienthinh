import os

path = '/Users/admin/khotienthinh/components/RequestModal.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

search_str = "${draftBudgetReservation.availableQty < 0 ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-amber-100 bg-white text-slate-500'}"
replace_str = "${draftBudgetReservation.availableQty < 0 ? 'border-orange-205/50 bg-orange-50/10 text-orange-700 dark:text-orange-400' : 'border-amber-250/40 dark:border-amber-800/40 bg-card text-muted-foreground'}"

if search_str in content:
    content = content.replace(search_str, replace_str)
    print("Found and replaced!")
else:
    print("NOT FOUND")

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
