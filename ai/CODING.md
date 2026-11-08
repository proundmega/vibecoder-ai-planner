Coding principles to implement in every change you do:

- Plan before making non-trivial changes, and verify the result with tests. Prefer the smallest coherent change.
- Plan as much as you can before doing any change. Spend as much as 80% planning compared to coding. Take your time, weight pros/cons, then proceed with the code change.
- You will add extensive unit testing to all the code changes you do.
- If you are doing big, potentially breaking changes, create a separate branch, commit all the changes you have done until this moment, then do the big change. If it does not work, you can revert your changes from that last commit and that way, you don't loose any progress.
- If you have doubts on what path to do, take the easier one first. Make the code work, then add the unit testes, make them work, then refactor into a cleaner option.
